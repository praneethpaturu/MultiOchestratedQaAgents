import { BaseAgent } from "./base.js";
import { TestDesign, AutomationResult, GeneratedTest } from "./types.js";
import { extractJSON } from "../utils/helpers.js";
import { findSelectorFixes } from "../memory/store.js";
import { AgentCard, AgentRequest, AgentResponse } from "./protocol.js";

const SYSTEM_PROMPT = `You are an expert Playwright automation engineer. You convert test cases into production-quality Playwright TypeScript tests.

You MUST follow these practices:
- Use Page Object Model (POM)
- Use data-testid selectors when possible, then ARIA roles, then CSS selectors (avoid XPath)
- Use proper Playwright waits (expect with polling, waitForSelector, etc.)
- Use Playwright fixtures for setup/teardown
- Handle loading states, animations, and network requests
- Each test must be independent and idempotent
- Use descriptive test names with test.describe blocks
- Add meaningful assertions (not just "page loaded")

Respond with JSON matching this schema:
{
  "storyId": number,
  "tests": [
    {
      "fileName": string (e.g., "login-flow.spec.ts"),
      "code": string (full Playwright test file content),
      "testCaseId": string,
      "pageObjects": [
        {
          "fileName": string (e.g., "LoginPage.ts"),
          "code": string (full page object content)
        }
      ]
    }
  ],
  "fixtureCode": string (optional shared fixture code)
}

POM Template:
\`\`\`ts
import { Page, Locator } from "@playwright/test";

export class ExamplePage {
  readonly page: Page;
  readonly someElement: Locator;

  constructor(page: Page) {
    this.page = page;
    this.someElement = page.getByTestId("element-id");
  }

  async navigate() { await this.page.goto("/path"); }
  async doAction() { /* ... */ }
}
\`\`\`

Test Template:
\`\`\`ts
import { test, expect } from "@playwright/test";
import { ExamplePage } from "../pages/ExamplePage";

test.describe("Feature Name", () => {
  let examplePage: ExamplePage;

  test.beforeEach(async ({ page }) => {
    examplePage = new ExamplePage(page);
    await examplePage.navigate();
  });

  test("should do something", async ({ page }) => {
    // ...
    await expect(examplePage.someElement).toBeVisible();
  });
});
\`\`\`
`;

export class AutomationEngineerAgent extends BaseAgent {
  constructor() {
    super("AutomationEngineer", "automation");
  }

  getAgentCard(): AgentCard {
    return {
      slug: "automation-engineer",
      name: "Automation Engineer",
      description: "Converts test cases into production Playwright TypeScript tests with POM",
      instructions: "Generates Playwright test specs and Page Object files from structured test cases. Uses stable selectors, proper waits, and fixtures.",
      skills: [
        {
          name: "generate_tests",
          description: "Convert test cases into Playwright TypeScript test files with Page Objects",
          parameters: [
            { name: "testDesign", type: "object", description: "TestDesign object from the test-designer agent", required: true },
          ],
        },
        {
          name: "apply_fix",
          description: "Apply a targeted fix to a specific test file based on error feedback",
          parameters: [
            { name: "test", type: "object", description: "The GeneratedTest object to fix", required: true },
            { name: "fixDescription", type: "string", description: "What needs to be fixed", required: true },
            { name: "errorLog", type: "string", description: "Error log from the failed test", required: true },
          ],
        },
      ],
      isOrchestrator: false,
    };
  }

  async handle(request: AgentRequest): Promise<AgentResponse> {
    const skill = request.skillName ?? "generate_tests";

    if (skill === "generate_tests") {
      const testDesign = request.arguments?.testDesign as TestDesign
        ?? request.context.state.testDesign as TestDesign;
      if (!testDesign) {
        return this.error("testDesign is required — run test-designer first");
      }
      try {
        const result = await this.generate(testDesign);
        return this.success(
          `Generated ${result.tests.length} test files with ${result.tests.reduce((s, t) => s + t.pageObjects.length, 0)} page objects`,
          result
        );
      } catch (err) {
        return this.error(`Test generation failed: ${(err as Error).message}`);
      }
    }

    if (skill === "apply_fix") {
      const test = request.arguments?.test as GeneratedTest;
      const fixDesc = request.arguments?.fixDescription as string;
      const errorLog = request.arguments?.errorLog as string;
      if (!test || !fixDesc) {
        return this.error("test and fixDescription are required for apply_fix");
      }
      try {
        const fixed = await this.applyFix(test, fixDesc, errorLog ?? "");
        return this.success(`Fixed ${fixed.fileName}`, fixed);
      } catch (err) {
        return this.error(`Fix failed: ${(err as Error).message}`);
      }
    }

    return this.error(`Unknown skill: ${skill}`);
  }

  async generate(testDesign: TestDesign): Promise<AutomationResult> {
    const automatableTests = testDesign.testCases.filter((tc) => tc.automatable);
    this.log.info(
      `Generating Playwright tests for ${automatableTests.length} test cases`
    );

    const selectorHistory = findSelectorFixes("");
    const healingHints =
      selectorHistory.length > 0
        ? `\n\nHistorical selector fixes (use these to choose more stable selectors):\n${selectorHistory
            .slice(0, 10)
            .map(
              (s) =>
                `- ${(s.data as Record<string, string>).oldSelector} → ${(s.data as Record<string, string>).newSelector}`
            )
            .join("\n")}`
        : "";

    const userPrompt = `Generate Playwright TypeScript tests for these test cases:

${JSON.stringify(automatableTests, null, 2)}
${healingHints}

Group related test cases into single spec files where logical.
Create appropriate Page Object files.
Respond with the JSON object only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 8000,
    });

    const result = extractJSON<AutomationResult>(response.content);
    result.storyId = testDesign.storyId;

    this.log.info(
      `Generated ${result.tests.length} test files with ${result.tests.reduce((sum, t) => sum + t.pageObjects.length, 0)} page objects`
    );
    return result;
  }

  async applyFix(
    originalTest: GeneratedTest,
    fixDescription: string,
    errorLog: string
  ): Promise<GeneratedTest> {
    this.log.info(`Applying fix to ${originalTest.fileName}: ${fixDescription}`);

    const userPrompt = `Fix the following Playwright test based on the error and suggested fix.

## Original Test (${originalTest.fileName})
\`\`\`ts
${originalTest.code}
\`\`\`

## Error Log
\`\`\`
${errorLog.slice(0, 2000)}
\`\`\`

## Required Fix
${fixDescription}

## Page Objects
${originalTest.pageObjects.map((po) => `### ${po.fileName}\n\`\`\`ts\n${po.code}\n\`\`\``).join("\n\n")}

Return the complete fixed test and page objects in the same JSON format as before.
Only change what's needed to fix the issue. Respond with JSON only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 6000,
    });

    const result = extractJSON<{ tests: GeneratedTest[] }>(response.content);
    return result.tests[0] ?? originalTest;
  }
}

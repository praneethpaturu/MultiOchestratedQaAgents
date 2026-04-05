import { BaseAgent } from "./base.js";
import { TestFailure, MaintenanceFix } from "./types.js";
import { extractJSON } from "../utils/helpers.js";
import { addMemory, findSelectorFixes } from "../memory/store.js";
import { AgentCard, AgentRequest, AgentResponse } from "./protocol.js";

const SYSTEM_PROMPT = `You are a Playwright maintenance and debugging specialist. You analyze test failures and produce targeted fixes.

Your analysis process:
1. Read the error message and stack trace
2. Identify the root cause (selector, timing, data, flow)
3. Propose a minimal fix that resolves the issue
4. Ensure the fix follows Playwright best practices

Common fix patterns:
- Broken selector → update to data-testid or ARIA role
- Timing issue → add proper wait (waitForSelector, expect with timeout)
- Stale element → re-query the element before interaction
- Navigation timing → waitForLoadState or waitForURL
- API dependency → use route.fulfill or waitForResponse

Respond with JSON matching:
{
  "fixes": [
    {
      "testName": string,
      "fileName": string,
      "originalCode": string (the specific block that needs changing),
      "fixedCode": string (the corrected block),
      "fixDescription": string
    }
  ]
}

Rules:
- Only change what's necessary to fix the failure
- Never remove assertions; fix them instead
- Prefer stable selectors (data-testid > role > CSS > text)
- Always include proper waits
`;

export class MaintenanceAgent extends BaseAgent {
  constructor() {
    super("MaintenanceAgent", "maintenance");
  }

  getAgentCard(): AgentCard {
    return {
      slug: "maintenance",
      name: "Maintenance Agent",
      description: "Diagnoses and fixes broken Playwright tests — locators, waits, and broken flows",
      instructions: "Analyzes test failures from Playwright execution, identifies root causes, and produces minimal targeted fixes. Records selector fixes in memory for self-healing.",
      skills: [
        {
          name: "diagnose_and_fix",
          description: "Analyze test failures and produce code fixes",
          parameters: [
            { name: "failures", type: "array", description: "Array of TestFailure objects", required: true },
            { name: "testCode", type: "string", description: "Current test source code", required: true },
          ],
        },
      ],
      isOrchestrator: false,
    };
  }

  async handle(request: AgentRequest): Promise<AgentResponse> {
    const failures = request.arguments?.failures as TestFailure[]
      ?? request.context.state.failures as TestFailure[];
    const testCode = request.arguments?.testCode as string
      ?? request.context.state.testCode as string;

    if (!failures || !testCode) {
      return this.error("failures and testCode are required");
    }

    try {
      const fixes = await this.diagnoseAndFix(failures, testCode);
      return this.success(
        `Produced ${fixes.length} fix(es) for ${failures.length} failure(s)`,
        fixes
      );
    } catch (err) {
      return this.error(`Maintenance failed: ${(err as Error).message}`);
    }
  }

  async diagnoseAndFix(
    failures: TestFailure[],
    testCode: string
  ): Promise<MaintenanceFix[]> {
    this.log.info(`Diagnosing ${failures.length} test failure(s)`);

    const pastFixes = findSelectorFixes("");
    const pastFixContext =
      pastFixes.length > 0
        ? `\n\nPast selector fixes in this project:\n${pastFixes
            .slice(0, 5)
            .map(
              (f) =>
                `- ${(f.data as Record<string, string>).oldSelector} → ${(f.data as Record<string, string>).newSelector} (${(f.data as Record<string, string>).reason})`
            )
            .join("\n")}`
        : "";

    const userPrompt = `Analyze and fix these Playwright test failures:

## Failures
${failures
  .map(
    (f) => `### ${f.testName} (${f.fileName})
Error: ${f.errorMessage}
Stack: ${f.errorStack.slice(0, 800)}
${f.screenshotPath ? `Screenshot: ${f.screenshotPath}` : ""}`
  )
  .join("\n\n")}

## Current Test Code
\`\`\`ts
${testCode}
\`\`\`
${pastFixContext}

Respond with JSON only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 6000,
    });

    const result = extractJSON<{ fixes: MaintenanceFix[] }>(response.content);

    for (const fix of result.fixes) {
      if (
        fix.fixDescription.toLowerCase().includes("selector") ||
        fix.fixDescription.toLowerCase().includes("locator")
      ) {
        addMemory({
          type: "selector_fix",
          testName: fix.testName,
          data: {
            oldSelector: this.extractSelector(fix.originalCode),
            newSelector: this.extractSelector(fix.fixedCode),
            reason: fix.fixDescription,
            page: fix.fileName,
          },
        });
      }
    }

    this.log.info(`Produced ${result.fixes.length} fix(es)`);
    return result.fixes;
  }

  private extractSelector(code: string): string {
    const patterns = [
      /getByTestId\(['"]([^'"]+)['"]\)/,
      /getByRole\(['"]([^'"]+)['"]/,
      /locator\(['"]([^'"]+)['"]\)/,
      /\$\(['"]([^'"]+)['"]\)/,
    ];
    for (const p of patterns) {
      const match = code.match(p);
      if (match) return match[0];
    }
    return code.slice(0, 80);
  }
}

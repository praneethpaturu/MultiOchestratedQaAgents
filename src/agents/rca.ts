import { BaseAgent } from "./base.js";
import { TestFailure, RCAResult, RCACategory } from "./types.js";
import { extractJSON } from "../utils/helpers.js";
import { addMemory, queryMemory } from "../memory/store.js";

const SYSTEM_PROMPT = `You are a deep Root Cause Analysis (RCA) specialist for automated UI testing. You analyze persistent test failures that could not be fixed by simple maintenance.

Your analysis must consider:
1. Playwright error logs and stack traces
2. DOM structure changes
3. Network failures and API response issues
4. Selector stability and specificity
5. Timing and race conditions
6. Environment/infrastructure issues
7. Actual product bugs vs test bugs

You MUST classify each failure into one of these categories:
- UI_CHANGE: The application UI has changed (new layout, redesign)
- LOCATOR_BROKEN: Selector is fragile or element was renamed
- API_FAILURE: Backend API returned error or unexpected data
- DATA_ISSUE: Test data is stale, missing, or corrupted
- ENVIRONMENT_ISSUE: Infrastructure, network, or deployment problem
- TEST_BUG: The test itself has a logic error
- PRODUCT_BUG: A genuine bug in the application under test

Respond with JSON matching:
{
  "results": [
    {
      "testName": string,
      "rootCause": string (concise description),
      "category": "UI_CHANGE" | "LOCATOR_BROKEN" | "API_FAILURE" | "DATA_ISSUE" | "ENVIRONMENT_ISSUE" | "TEST_BUG" | "PRODUCT_BUG",
      "confidence": number (0.0 to 1.0),
      "suggestedFix": string,
      "isAutomationIssue": boolean,
      "isProductBug": boolean,
      "details": string (detailed analysis)
    }
  ]
}

Key rules:
- Be precise: a broken locator is LOCATOR_BROKEN, not PRODUCT_BUG
- High confidence (>0.8) only when evidence is strong
- Product bugs require clear evidence that the app behaves incorrectly
- Include specific technical details in suggestedFix
- isProductBug should be true ONLY for PRODUCT_BUG category
- isAutomationIssue covers UI_CHANGE, LOCATOR_BROKEN, TEST_BUG
`;

export class RCAAgent extends BaseAgent {
  constructor() {
    super("RCAAgent", "rca");
  }

  async analyze(
    failures: TestFailure[],
    testCode: string,
    maintenanceAttempts: number
  ): Promise<RCAResult[]> {
    this.log.info(
      `Deep RCA analysis for ${failures.length} persistent failure(s) (after ${maintenanceAttempts} maintenance attempts)`
    );

    // Get past RCA results for pattern detection
    const pastRCA = queryMemory({ type: "rca_result", limit: 10 });
    const patternContext =
      pastRCA.length > 0
        ? `\n\nPast RCA findings (detect patterns):\n${pastRCA
            .map(
              (r) =>
                `- ${r.testName}: ${(r.data as Record<string, string>).category} - ${(r.data as Record<string, string>).rootCause}`
            )
            .join("\n")}`
        : "";

    const userPrompt = `Perform deep root cause analysis on these persistent test failures.
These tests have ALREADY been through ${maintenanceAttempts} maintenance fix attempt(s) and still fail.

## Failures
${failures
  .map(
    (f) => `### ${f.testName} (${f.fileName})
Error: ${f.errorMessage}
Stack Trace:
${f.errorStack.slice(0, 1500)}
Duration: ${f.duration}ms
${f.screenshotPath ? `Screenshot: ${f.screenshotPath}` : ""}`
  )
  .join("\n\n")}

## Test Code
\`\`\`ts
${testCode}
\`\`\`
${patternContext}

Analyze thoroughly and respond with JSON only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 6000,
      temperature: 0.1,
    });

    const parsed = extractJSON<{ results: RCAResult[] }>(response.content);

    // Enrich with error logs and store in memory
    const results: RCAResult[] = parsed.results.map((r, i) => {
      const enriched: RCAResult = {
        ...r,
        errorLog: failures[i]?.errorStack ?? "",
      };

      addMemory({
        type: "rca_result",
        testName: r.testName,
        data: {
          rootCause: r.rootCause,
          category: r.category,
          confidence: r.confidence,
          isProductBug: r.isProductBug,
        },
      });

      return enriched;
    });

    this.logSummary(results);
    return results;
  }

  private logSummary(results: RCAResult[]): void {
    const productBugs = results.filter((r) => r.isProductBug);
    const testBugs = results.filter((r) => r.category === "TEST_BUG");
    const envIssues = results.filter(
      (r) => r.category === "ENVIRONMENT_ISSUE"
    );

    this.log.info(`RCA Summary:`);
    this.log.info(`  Product bugs: ${productBugs.length}`);
    this.log.info(`  Test bugs: ${testBugs.length}`);
    this.log.info(`  Environment issues: ${envIssues.length}`);
    this.log.info(
      `  Other: ${results.length - productBugs.length - testBugs.length - envIssues.length}`
    );

    for (const r of results) {
      this.log.info(
        `  [${r.category}] ${r.testName}: ${r.rootCause} (confidence: ${r.confidence})`
      );
    }
  }

  /**
   * Determine the action to take based on RCA category.
   */
  static decideAction(
    result: RCAResult
  ): "fix_test" | "create_bug" | "retry" | "flag_infra" {
    switch (result.category) {
      case "PRODUCT_BUG":
        return "create_bug";
      case "ENVIRONMENT_ISSUE":
        return "flag_infra";
      case "TEST_BUG":
      case "LOCATOR_BROKEN":
      case "UI_CHANGE":
        return "fix_test";
      case "API_FAILURE":
        return result.isProductBug ? "create_bug" : "retry";
      case "DATA_ISSUE":
        return "retry";
      default:
        return "fix_test";
    }
  }
}

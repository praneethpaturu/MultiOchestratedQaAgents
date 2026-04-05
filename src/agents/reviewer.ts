import { BaseAgent } from "./base.js";
import { PipelineContext, ReviewResult } from "./types.js";
import { extractJSON } from "../utils/helpers.js";

const SYSTEM_PROMPT = `You are a strict QA Governance Reviewer. You validate the entire output of the QA pipeline.

You MUST evaluate ALL of the following criteria and assign a pass/fail:
1. REQUIREMENT COVERAGE: Are all acceptance criteria covered by test cases?
2. TEST COMPLETENESS: Are there positive, negative, edge case, and boundary tests?
3. DUPLICATE TESTS: Are there redundant or overlapping test cases?
4. CODE QUALITY: Is the Playwright code clean, maintainable, and well-structured?
5. PLAYWRIGHT BEST PRACTICES: POM, stable selectors, proper waits, fixtures
6. FLAKY TEST RISK: Are there timing-sensitive assertions or unstable patterns?
7. RCA ACCURACY: If RCA was performed, is the analysis reasonable?
8. BUG QUALITY: If bugs were filed, do they have complete information?

Scoring:
- Each criterion is worth up to 12.5 points (8 criteria = 100 total)
- Minimum passing score: 70
- Any "blocker" severity issue = automatic rejection regardless of score

Respond with JSON:
{
  "approved": boolean,
  "score": number (0-100),
  "issues": [
    {
      "category": string (one of the 8 criteria above),
      "severity": "blocker" | "major" | "minor",
      "description": string,
      "suggestion": string,
      "location": string (optional: file or test name)
    }
  ],
  "summary": string
}

Be strict but fair. Quality gates matter.
`;

export class ReviewerAgent extends BaseAgent {
  constructor() {
    super("ReviewerAgent", "reviewer");
  }

  async review(context: PipelineContext): Promise<ReviewResult> {
    this.log.info(
      `Reviewing pipeline output for story #${context.storyId} (loop ${context.reviewerLoops + 1})`
    );

    const userPrompt = `Review the complete QA pipeline output:

## Story
ID: ${context.storyId}
Title: ${context.storyTitle}

## Requirements Analysis
${context.requirements ? JSON.stringify(context.requirements, null, 2) : "NOT AVAILABLE"}

## Test Design
${context.testDesign ? `${context.testDesign.testCases.length} test cases:\n${JSON.stringify(context.testDesign.testCases, null, 2)}` : "NOT AVAILABLE"}

## Automation
${
  context.automation
    ? `${context.automation.tests.length} test file(s):\n${context.automation.tests
        .map(
          (t) => `### ${t.fileName}\n\`\`\`ts\n${t.code.slice(0, 1500)}\n\`\`\``
        )
        .join("\n\n")}`
    : "NOT AVAILABLE"
}

## Test Execution
Failures: ${context.failures.length}
${context.failures.map((f) => `- ${f.testName}: ${f.errorMessage}`).join("\n")}

## RCA Results
${
  context.rcaResults.length > 0
    ? context.rcaResults
        .map(
          (r) =>
            `- ${r.testName}: ${r.category} (confidence: ${r.confidence}) - ${r.rootCause}`
        )
        .join("\n")
    : "No RCA performed"
}

## Bugs Filed
${
  context.bugs.length > 0
    ? context.bugs.map((b) => `- Bug #${b.id}: ${b.url}`).join("\n")
    : "No bugs filed"
}

## Pipeline Stats
Maintenance attempts: ${context.maintenanceAttempts}
Reviewer loops: ${context.reviewerLoops}

Evaluate strictly. Respond with JSON only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 4096,
      temperature: 0.1,
    });

    const result = extractJSON<ReviewResult>(response.content);

    if (result.approved) {
      this.log.info(`APPROVED (score: ${result.score}/100)`);
    } else {
      this.log.warn(
        `REJECTED (score: ${result.score}/100, ${result.issues.length} issues)`
      );
      for (const issue of result.issues) {
        this.log.warn(
          `  [${issue.severity}] ${issue.category}: ${issue.description}`
        );
      }
    }

    return result;
  }
}

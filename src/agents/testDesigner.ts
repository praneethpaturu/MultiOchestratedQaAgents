import { BaseAgent } from "./base.js";
import { RequirementAnalysis, TestDesign } from "./types.js";
import { extractJSON } from "../utils/helpers.js";
import { getFlakyTests } from "../memory/store.js";

const SYSTEM_PROMPT = `You are an expert Test Designer. Given analyzed requirements, you produce structured, prioritized manual test cases that can be automated.

You MUST respond with a JSON object matching this schema:
{
  "storyId": number,
  "testCases": [
    {
      "id": string (format: "TC-001"),
      "scenarioId": string (links to scenario ID),
      "title": string,
      "description": string,
      "preconditions": string[],
      "steps": [
        { "action": string, "expected": string }
      ],
      "priority": "P0" | "P1" | "P2" | "P3",
      "tags": string[],
      "automatable": boolean,
      "riskLevel": "high" | "medium" | "low"
    }
  ],
  "coverageNotes": string
}

Rules:
- Map each scenario to at least one test case
- P0 = smoke/critical, P1 = core, P2 = detailed, P3 = nice-to-have
- Each step must have a clear action and expected result
- Mark test cases that are hard to automate as automatable: false
- Prioritize risk-based: high-risk scenarios get more test cases
- Avoid duplicate or overlapping test cases
- Include data-driven variations where appropriate
- Tag for grouping (smoke, regression, etc.)
`;

export class TestDesignerAgent extends BaseAgent {
  constructor() {
    super("TestDesigner", "testDesign");
  }

  async design(requirements: RequirementAnalysis): Promise<TestDesign> {
    this.log.info(
      `Designing tests for story #${requirements.storyId} (${requirements.scenarios.length} scenarios)`
    );

    // Pull flaky test history for risk awareness
    const flakyHistory = getFlakyTests(10);
    const flakyContext =
      flakyHistory.length > 0
        ? `\n\nKnown flaky test areas (be extra careful here):\n${flakyHistory
            .map((f) => `- ${f.testName}: ${(f.data as Record<string, string>).reason}`)
            .join("\n")}`
        : "";

    const userPrompt = `Design comprehensive test cases for the following analyzed requirements:

${JSON.stringify(requirements, null, 2)}
${flakyContext}

Respond with the JSON object only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 6000,
    });

    const design = extractJSON<TestDesign>(response.content);
    design.storyId = requirements.storyId;

    this.log.info(
      `Designed ${design.testCases.length} test cases (${design.testCases.filter((t) => t.automatable).length} automatable)`
    );
    return design;
  }
}

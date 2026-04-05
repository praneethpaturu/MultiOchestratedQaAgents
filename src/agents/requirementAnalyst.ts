import { BaseAgent } from "./base.js";
import { RequirementAnalysis } from "./types.js";
import { UserStory } from "../ado/storyService.js";
import { extractJSON } from "../utils/helpers.js";

const SYSTEM_PROMPT = `You are an expert QA Requirement Analyst. Your job is to analyze user stories and extract comprehensive test-relevant information.

You MUST respond with a JSON object matching this schema:
{
  "storyId": number,
  "title": string,
  "acceptanceCriteria": string[],
  "scenarios": [
    {
      "id": string (format: "SC-001"),
      "name": string,
      "description": string,
      "steps": string[],
      "expectedResult": string,
      "priority": "critical" | "high" | "medium" | "low",
      "tags": string[],
      "type": "positive" | "negative" | "edge_case" | "boundary"
    }
  ],
  "edgeCases": string[],
  "assumptions": string[],
  "outOfScope": string[]
}

Rules:
- Extract ALL acceptance criteria, even implicit ones
- Generate scenarios for: happy path, error cases, edge cases, boundary conditions
- Assign realistic priorities
- Tag scenarios meaningfully (e.g., "login", "validation", "accessibility")
- Identify at least 3 edge cases
- Document assumptions and out-of-scope items
- Be thorough but practical
`;

export class RequirementAnalystAgent extends BaseAgent {
  constructor() {
    super("RequirementAnalyst", "requirement");
  }

  async analyze(story: UserStory): Promise<RequirementAnalysis> {
    this.log.info(`Analyzing story #${story.id}: "${story.title}"`);

    const userPrompt = `Analyze this user story and extract all testable requirements:

## Story #${story.id}: ${story.title}

### Description
${story.description || "(no description)"}

### Acceptance Criteria
${story.acceptanceCriteria || "(no explicit AC — infer from description)"}

### Tags
${story.tags.join(", ") || "(none)"}

Respond with the JSON object only.`;

    const response = await this.ask(SYSTEM_PROMPT, userPrompt, {
      maxTokens: 4096,
    });

    const analysis = extractJSON<RequirementAnalysis>(response.content);
    analysis.storyId = story.id;

    this.log.info(
      `Analysis complete: ${analysis.scenarios.length} scenarios, ${analysis.edgeCases.length} edge cases`
    );
    return analysis;
  }
}

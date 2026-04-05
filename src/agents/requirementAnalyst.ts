import { BaseAgent } from "./base.js";
import { RequirementAnalysis } from "./types.js";
import { UserStory } from "../ado/storyService.js";
import { fetchStory } from "../ado/storyService.js";
import { extractJSON } from "../utils/helpers.js";
import { AgentCard, AgentRequest, AgentResponse } from "./protocol.js";

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

  getAgentCard(): AgentCard {
    return {
      slug: "requirement-analyst",
      name: "Requirement Analyst",
      description: "Analyzes ADO user stories to extract scenarios, edge cases, and acceptance criteria",
      instructions: "Given a user story ID, fetches the story from Azure DevOps and produces a structured requirement analysis with scenarios, edge cases, and assumptions.",
      skills: [
        {
          name: "analyze_story",
          description: "Fetch an ADO user story and extract all testable requirements, scenarios, and edge cases",
          parameters: [
            { name: "storyId", type: "number", description: "Azure DevOps work item ID", required: true },
          ],
        },
      ],
      isOrchestrator: false,
    };
  }

  async handle(request: AgentRequest): Promise<AgentResponse> {
    const storyId = request.arguments?.storyId as number
      ?? request.context.storyId;

    if (!storyId) {
      return this.error("storyId is required");
    }

    try {
      const story = await fetchStory(storyId);
      const analysis = await this.analyze(story);
      return this.success(
        `Analyzed story #${storyId}: ${analysis.scenarios.length} scenarios, ${analysis.edgeCases.length} edge cases`,
        analysis
      );
    } catch (err) {
      return this.error(`Failed to analyze story #${storyId}: ${(err as Error).message}`);
    }
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

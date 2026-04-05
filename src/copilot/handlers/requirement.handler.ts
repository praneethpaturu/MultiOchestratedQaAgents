/**
 * @qa-agent /analyze — Copilot Extension Handler
 *
 * Fetches an ADO user story and extracts scenarios,
 * acceptance criteria, and edge cases.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, streamReferences, streamCode, endStream, streamErrorAndEnd } from "../streaming.js";
import { RequirementAnalystAgent } from "../../agents/requirementAnalyst.js";
import { fetchStory } from "../../ado/storyService.js";

export const requirementHandler: CopilotAgentHandler = {
  slug: "requirement-analyst",
  name: "Requirement Analyst",
  description: "Analyze an ADO user story and extract testable requirements",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    const storyId = extractStoryId(ctx.userMessage);
    if (!storyId) {
      streamText(ctx.res, "Please provide a story ID. Usage: `@qa-agent /analyze <story-id>`");
      endStream(ctx.res);
      return;
    }

    try {
      streamStatus(ctx.res, "requirement-analyst", `Fetching and analyzing story #${storyId}...`);

      const story = await fetchStory(storyId);

      // Stream a reference to the ADO story
      if (story.url) {
        streamReferences(ctx.res, [{
          type: "issue",
          id: `story-${storyId}`,
          title: `Story #${storyId}: ${story.title}`,
          url: story.url,
          icon: "issue-opened",
        }]);
      }

      streamStatus(ctx.res, "requirement-analyst", "Extracting scenarios and edge cases...");

      const agent = new RequirementAnalystAgent();
      const analysis = await agent.analyze(story);

      // Stream results
      streamSection(ctx.res, `Story #${storyId}: ${story.title}`, "");

      streamText(ctx.res, `**Acceptance Criteria (${analysis.acceptanceCriteria.length}):**\n`);
      for (const ac of analysis.acceptanceCriteria) {
        streamText(ctx.res, `- ${ac}\n`);
      }

      streamText(ctx.res, `\n**Scenarios (${analysis.scenarios.length}):**\n`);
      for (const sc of analysis.scenarios) {
        const badge = sc.priority === "critical" ? "🔴" : sc.priority === "high" ? "🟠" : sc.priority === "medium" ? "🟡" : "🟢";
        streamText(ctx.res, `\n${badge} **${sc.id}: ${sc.name}** (${sc.type})\n`);
        streamText(ctx.res, `> ${sc.description}\n`);
        streamText(ctx.res, `Steps: ${sc.steps.join(" → ")}\n`);
        streamText(ctx.res, `Expected: ${sc.expectedResult}\n`);
      }

      streamText(ctx.res, `\n**Edge Cases (${analysis.edgeCases.length}):**\n`);
      for (const ec of analysis.edgeCases) {
        streamText(ctx.res, `- ${ec}\n`);
      }

      if (analysis.assumptions.length > 0) {
        streamText(ctx.res, `\n**Assumptions:**\n`);
        for (const a of analysis.assumptions) {
          streamText(ctx.res, `- ${a}\n`);
        }
      }

      streamText(ctx.res, `\n---\n_Analysis complete. Use \`/design\` to create test cases from these scenarios._\n`);

      endStream(ctx.res);
    } catch (err) {
      streamErrorAndEnd(ctx.res, `Failed to analyze story #${storyId}: ${(err as Error).message}`);
    }
  },
};

function extractStoryId(message: string): number | null {
  const match = message.match(/\b(\d{2,})\b/);
  return match ? parseInt(match[1], 10) : null;
}

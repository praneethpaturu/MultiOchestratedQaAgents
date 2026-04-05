/**
 * @qa-agent /clarify — Copilot Extension Handler
 *
 * Identifies ambiguities in user stories and asks the user
 * targeted clarification questions via Copilot Chat.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, streamConfirmation, endStream, streamErrorAndEnd } from "../streaming.js";
import { ClarifierAgent } from "../../agents/clarifier.js";
import { fetchStory } from "../../ado/storyService.js";

export const clarifierHandler: CopilotAgentHandler = {
  slug: "clarifier",
  name: "Clarifier Agent",
  description: "Analyze a user story for ambiguities and missing information",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    // Parse story ID from message
    const storyId = extractStoryId(ctx.userMessage);
    if (!storyId) {
      streamText(ctx.res, "Please provide a story ID. Usage: `@qa-agent /clarify <story-id>`");
      endStream(ctx.res);
      return;
    }

    try {
      streamStatus(ctx.res, "clarifier", `Analyzing story #${storyId} for ambiguities...`);

      const story = await fetchStory(storyId);
      const agent = new ClarifierAgent();
      const result = await agent.analyzeClarity(story);

      if (!result.needsClarification) {
        streamSection(ctx.res, "Clarity Check", "The story requirements are clear. No clarification needed.");
        streamText(ctx.res, `\n**Assumptions made:**\n${result.assumptions.map((a) => `- ${a}`).join("\n")}\n`);
      } else {
        streamSection(ctx.res, `Clarification Needed (${result.questions.length} questions)`, result.summary);

        for (const q of result.questions) {
          const blocking = q.blocking ? " **(blocking)**" : "";
          streamText(ctx.res, `\n**[${q.id}]** ${q.question}${blocking}\n`);
          streamText(ctx.res, `> _Category:_ ${q.category} | _Default assumption:_ ${q.defaultAssumption}\n`);
        }

        // If there are blocking questions, send a confirmation
        if (result.questions.some((q) => q.blocking)) {
          streamConfirmation(
            ctx.res,
            `clarify-${storyId}`,
            "Proceed with default assumptions?",
            "Some questions are blocking. Do you want to proceed using the default assumptions listed above?",
            { storyId, questions: result.questions }
          );
        }
      }

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

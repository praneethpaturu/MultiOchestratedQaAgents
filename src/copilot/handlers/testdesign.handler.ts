/**
 * @qa-agent /design — Copilot Extension Handler
 *
 * Creates structured, prioritized test cases from
 * requirement analysis output.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, endStream, streamErrorAndEnd } from "../streaming.js";
import { TestDesignerAgent } from "../../agents/testDesigner.js";
import { RequirementAnalystAgent } from "../../agents/requirementAnalyst.js";
import { fetchStory } from "../../ado/storyService.js";
import type { RequirementAnalysis } from "../../agents/types.js";
import { getThreadState, setThreadState } from "../state.js";

export const testDesignHandler: CopilotAgentHandler = {
  slug: "test-designer",
  name: "Test Designer",
  description: "Design prioritized test cases from requirements",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    try {
      // Try to get requirements from thread state (set by /analyze)
      let requirements = getThreadState<RequirementAnalysis>(ctx.threadId, "requirements");

      if (!requirements) {
        // No prior analysis — need a story ID to run analysis first
        const storyId = extractStoryId(ctx.userMessage);
        if (!storyId) {
          streamText(ctx.res, "No prior analysis found. Please provide a story ID: `@qa-agent /design <story-id>`\n\nOr run `/analyze <story-id>` first.");
          endStream(ctx.res);
          return;
        }

        streamStatus(ctx.res, "requirement-analyst", `No prior analysis — analyzing story #${storyId} first...`);
        const story = await fetchStory(storyId);
        const reqAgent = new RequirementAnalystAgent();
        requirements = await reqAgent.analyze(story);
        setThreadState(ctx.threadId, "requirements", requirements);
      }

      streamStatus(ctx.res, "test-designer", `Designing test cases for ${requirements.scenarios.length} scenarios...`);

      const designer = new TestDesignerAgent();
      const design = await designer.design(requirements);

      // Store for downstream agents
      setThreadState(ctx.threadId, "testDesign", design);

      // Stream results
      streamSection(ctx.res, `Test Design — ${design.testCases.length} Test Cases`, "");

      // Group by priority
      const byPriority = { P0: [] as typeof design.testCases, P1: [] as typeof design.testCases, P2: [] as typeof design.testCases, P3: [] as typeof design.testCases };
      for (const tc of design.testCases) {
        byPriority[tc.priority].push(tc);
      }

      for (const [priority, cases] of Object.entries(byPriority)) {
        if (cases.length === 0) continue;
        streamText(ctx.res, `\n#### ${priority} (${cases.length} cases)\n`);
        for (const tc of cases) {
          const auto = tc.automatable ? "🤖" : "👤";
          const risk = tc.riskLevel === "high" ? "🔴" : tc.riskLevel === "medium" ? "🟡" : "🟢";
          streamText(ctx.res, `\n${auto} **${tc.id}: ${tc.title}** ${risk}\n`);
          streamText(ctx.res, `> ${tc.description}\n`);
          if (tc.preconditions.length > 0) {
            streamText(ctx.res, `Preconditions: ${tc.preconditions.join(", ")}\n`);
          }
          streamText(ctx.res, `Steps:\n`);
          for (let i = 0; i < tc.steps.length; i++) {
            streamText(ctx.res, `${i + 1}. **Do:** ${tc.steps[i].action}\n   **Expect:** ${tc.steps[i].expected}\n`);
          }
          streamText(ctx.res, `Tags: ${tc.tags.join(", ")}\n`);
        }
      }

      streamText(ctx.res, `\n**Coverage Notes:** ${design.coverageNotes}\n`);
      streamText(ctx.res, `\n---\n_${design.testCases.filter((t) => t.automatable).length} automatable cases. Use \`/generate\` to create Playwright tests._\n`);

      endStream(ctx.res);
    } catch (err) {
      streamErrorAndEnd(ctx.res, `Test design failed: ${(err as Error).message}`);
    }
  },
};

function extractStoryId(message: string): number | null {
  const match = message.match(/\b(\d{2,})\b/);
  return match ? parseInt(match[1], 10) : null;
}

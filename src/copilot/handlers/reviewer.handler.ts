/**
 * @qa-agent /review — Copilot Extension Handler
 *
 * Strict governance review of the entire pipeline output.
 * Scores across 8 criteria and approves/rejects.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, endStream, streamErrorAndEnd } from "../streaming.js";
import { ReviewerAgent } from "../../agents/reviewer.js";
import { getThreadState } from "../state.js";
import type { PipelineContext } from "../../agents/types.js";

export const reviewerHandler: CopilotAgentHandler = {
  slug: "reviewer",
  name: "Reviewer Agent",
  description: "Governance review — validates coverage, quality, flakiness risk, and RCA accuracy",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    try {
      // Build pipeline context from thread state
      const requirements = getThreadState(ctx.threadId, "requirements");
      const testDesign = getThreadState(ctx.threadId, "testDesign");
      const automation = getThreadState(ctx.threadId, "automation");

      if (!requirements && !testDesign && !automation) {
        streamText(ctx.res, "No pipeline data found for this conversation. Run `/analyze`, `/design`, and `/generate` first, or use `/run <story-id>` for the full pipeline.\n");
        endStream(ctx.res);
        return;
      }

      const pipelineCtx: PipelineContext = {
        storyId: (requirements as any)?.storyId ?? 0,
        storyTitle: (requirements as any)?.title ?? "Unknown",
        requirements: requirements as any,
        testDesign: testDesign as any,
        automation: automation as any,
        failures: (getThreadState(ctx.threadId, "failures") as any[]) ?? [],
        rcaResults: (getThreadState(ctx.threadId, "rcaResults") as any[]) ?? [],
        bugs: (getThreadState(ctx.threadId, "bugs") as any[]) ?? [],
        maintenanceAttempts: 0,
        reviewerLoops: 0,
      };

      streamStatus(ctx.res, "reviewer", "Running governance review across 8 criteria...");

      const agent = new ReviewerAgent();
      const result = await agent.review(pipelineCtx);

      // Header with pass/fail
      const verdict = result.approved ? "✅ APPROVED" : "❌ REJECTED";
      streamSection(ctx.res, `Review: ${verdict} (Score: ${result.score}/100)`, "");

      // Score bar
      const scoreBar = "█".repeat(Math.round(result.score / 5)) + "░".repeat(20 - Math.round(result.score / 5));
      streamText(ctx.res, `\n\`[${scoreBar}]\` **${result.score}/100** (minimum: 70)\n`);

      // Issues table
      if (result.issues.length > 0) {
        streamText(ctx.res, `\n#### Issues Found (${result.issues.length})\n\n`);
        streamText(ctx.res, `| Severity | Category | Description | Suggestion |\n|---|---|---|---|\n`);
        for (const issue of result.issues) {
          const sevIcon = issue.severity === "blocker" ? "🚫" : issue.severity === "major" ? "⚠️" : "💡";
          streamText(ctx.res, `| ${sevIcon} ${issue.severity} | ${issue.category} | ${issue.description} | ${issue.suggestion} |\n`);
        }
      }

      streamText(ctx.res, `\n**Summary:** ${result.summary}\n`);

      if (!result.approved) {
        const blockers = result.issues.filter((i) => i.severity === "blocker");
        const majors = result.issues.filter((i) => i.severity === "major");
        streamText(ctx.res, `\n---\n_${blockers.length} blocker(s), ${majors.length} major issue(s) must be resolved. Fix and re-run \`/review\`._\n`);
      }

      endStream(ctx.res);
    } catch (err) {
      streamErrorAndEnd(ctx.res, `Review failed: ${(err as Error).message}`);
    }
  },
};

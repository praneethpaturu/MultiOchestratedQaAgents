/**
 * @qa-agent /rca — Copilot Extension Handler
 *
 * Deep root cause analysis of persistent test failures.
 * Classifies into 7 categories and recommends next action.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, streamCode, streamReferences, endStream, streamErrorAndEnd } from "../streaming.js";
import { RCAAgent } from "../../agents/rca.js";
import type { TestFailure, RCAResult } from "../../agents/types.js";

export const rcaHandler: CopilotAgentHandler = {
  slug: "rca",
  name: "Root Cause Analysis Agent",
  description: "Deep analysis of persistent test failures — classifies cause and recommends action",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    try {
      const failures = parseFailuresFromMessage(ctx.userMessage);
      const testCode = extractCodeBlock(ctx.userMessage) || "";
      const attempts = extractAttempts(ctx.userMessage);

      if (failures.length === 0) {
        streamText(ctx.res, "Please provide test failure details for RCA. Include error logs and test code.\n\n");
        streamText(ctx.res, "Usage: `@qa-agent /rca` with failure details pasted in the message.\n");
        endStream(ctx.res);
        return;
      }

      streamStatus(ctx.res, "rca", `Performing deep analysis on ${failures.length} failure(s)...`);

      const agent = new RCAAgent();
      const results = await agent.analyze(failures, testCode, attempts);

      streamSection(ctx.res, `Root Cause Analysis — ${results.length} Result(s)`, "");

      for (const r of results) {
        const icon = getCategoryIcon(r.category);
        const confBar = getConfidenceBar(r.confidence);
        const action = RCAAgent.decideAction(r);

        streamText(ctx.res, `\n#### ${icon} ${r.testName}\n`);
        streamText(ctx.res, `| Field | Value |\n|---|---|\n`);
        streamText(ctx.res, `| **Category** | \`${r.category}\` |\n`);
        streamText(ctx.res, `| **Root Cause** | ${r.rootCause} |\n`);
        streamText(ctx.res, `| **Confidence** | ${confBar} ${(r.confidence * 100).toFixed(0)}% |\n`);
        streamText(ctx.res, `| **Is Product Bug** | ${r.isProductBug ? "Yes 🐛" : "No"} |\n`);
        streamText(ctx.res, `| **Is Automation Issue** | ${r.isAutomationIssue ? "Yes" : "No"} |\n`);
        streamText(ctx.res, `| **Recommended Action** | **${formatAction(action)}** |\n`);

        streamText(ctx.res, `\n**Suggested Fix:** ${r.suggestedFix}\n`);

        if (r.details) {
          streamText(ctx.res, `\n<details><summary>Detailed Analysis</summary>\n\n${r.details}\n\n</details>\n`);
        }
      }

      // Summary
      const productBugs = results.filter((r) => r.isProductBug);
      const testBugs = results.filter((r) => r.category === "TEST_BUG");
      const envIssues = results.filter((r) => r.category === "ENVIRONMENT_ISSUE");

      streamText(ctx.res, `\n---\n**Summary:** `);
      streamText(ctx.res, `${productBugs.length} product bug(s), ${testBugs.length} test bug(s), ${envIssues.length} env issue(s)\n`);

      if (productBugs.length > 0) {
        streamText(ctx.res, `\n_Product bugs detected. Use \`/run <story-id>\` to auto-file ADO bugs._\n`);
      }

      endStream(ctx.res);
    } catch (err) {
      streamErrorAndEnd(ctx.res, `RCA failed: ${(err as Error).message}`);
    }
  },
};

function getCategoryIcon(cat: string): string {
  const icons: Record<string, string> = {
    UI_CHANGE: "🎨",
    LOCATOR_BROKEN: "🔗",
    API_FAILURE: "🌐",
    DATA_ISSUE: "💾",
    ENVIRONMENT_ISSUE: "🏗️",
    TEST_BUG: "🧪",
    PRODUCT_BUG: "🐛",
  };
  return icons[cat] ?? "❓";
}

function getConfidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    fix_test: "🔧 Fix the test code",
    create_bug: "🐛 Create ADO bug",
    retry: "🔄 Retry execution",
    flag_infra: "🏗️ Flag infrastructure team",
  };
  return labels[action] ?? action;
}

function parseFailuresFromMessage(message: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const errorMatch = message.match(/Error:\s*(.+)/i);
  if (errorMatch) {
    failures.push({
      testName: message.match(/Test:\s*(.+)/i)?.[1]?.trim() ?? "from-chat",
      fileName: message.match(/File:\s*(.+)/i)?.[1]?.trim() ?? "unknown.spec.ts",
      errorMessage: errorMatch[1].trim(),
      errorStack: message,
      duration: 0,
    });
  }
  return failures;
}

function extractCodeBlock(message: string): string | null {
  const match = message.match(/```(?:ts|typescript)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

function extractAttempts(message: string): number {
  const match = message.match(/attempts?:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

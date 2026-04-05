/**
 * @qa-agent /fix — Copilot Extension Handler
 *
 * Diagnoses and fixes broken Playwright tests based on
 * failure logs provided in the chat message.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, streamCode, endStream, streamErrorAndEnd } from "../streaming.js";
import { MaintenanceAgent } from "../../agents/maintenance.js";
import type { TestFailure } from "../../agents/types.js";

export const maintenanceHandler: CopilotAgentHandler = {
  slug: "maintenance",
  name: "Maintenance Agent",
  description: "Diagnose and fix broken Playwright tests",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    try {
      // Parse failure info from the message or conversation context
      const failures = parseFailuresFromMessage(ctx.userMessage);
      if (failures.length === 0) {
        streamText(ctx.res, "Please provide test failure details. Example:\n\n");
        streamText(ctx.res, "```\n@qa-agent /fix\nTest: login-flow.spec.ts\nError: locator.click: Timeout waiting for selector '[data-testid=\"submit-btn\"]'\nCode:\ntest('should login', async ({ page }) => { ... })\n```\n");
        endStream(ctx.res);
        return;
      }

      // Extract code from message
      const testCode = extractCodeBlock(ctx.userMessage) || "// No test code provided — agent will infer from error";

      streamStatus(ctx.res, "maintenance", `Diagnosing ${failures.length} failure(s)...`);

      const agent = new MaintenanceAgent();
      const fixes = await agent.diagnoseAndFix(failures, testCode);

      streamSection(ctx.res, `${fixes.length} Fix(es) Generated`, "");

      for (const fix of fixes) {
        streamText(ctx.res, `\n#### 🔧 ${fix.testName} (${fix.fileName})\n`);
        streamText(ctx.res, `**Diagnosis:** ${fix.fixDescription}\n`);

        streamText(ctx.res, `\n**Before:**\n`);
        streamCode(ctx.res, fix.originalCode);

        streamText(ctx.res, `\n**After:**\n`);
        streamCode(ctx.res, fix.fixedCode);
      }

      streamText(ctx.res, `\n---\n_Apply these fixes and re-run your tests._\n`);

      endStream(ctx.res);
    } catch (err) {
      streamErrorAndEnd(ctx.res, `Maintenance failed: ${(err as Error).message}`);
    }
  },
};

function parseFailuresFromMessage(message: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // Try to find structured failure info
  const testNameMatch = message.match(/Test:\s*(.+)/i);
  const errorMatch = message.match(/Error:\s*(.+)/i);
  const fileMatch = message.match(/File:\s*(.+)/i);

  if (errorMatch) {
    failures.push({
      testName: testNameMatch?.[1]?.trim() ?? "unknown",
      fileName: fileMatch?.[1]?.trim() ?? testNameMatch?.[1]?.trim() ?? "unknown.spec.ts",
      errorMessage: errorMatch[1].trim(),
      errorStack: message,
      duration: 0,
    });
  }

  // Also check for Playwright-style error output
  const pwErrorMatch = message.match(/Error: (.+?)(?:\n|$)/g);
  if (pwErrorMatch && failures.length === 0) {
    for (const err of pwErrorMatch) {
      failures.push({
        testName: "from-chat",
        fileName: "unknown.spec.ts",
        errorMessage: err.replace("Error: ", "").trim(),
        errorStack: message,
        duration: 0,
      });
    }
  }

  return failures;
}

function extractCodeBlock(message: string): string | null {
  const match = message.match(/```(?:ts|typescript)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

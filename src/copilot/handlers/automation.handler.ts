/**
 * @qa-agent /generate — Copilot Extension Handler
 *
 * Generates Playwright TypeScript tests with Page Object Model
 * from designed test cases.
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import { initSSE, streamText, streamSection, streamStatus, streamCode, endStream, streamErrorAndEnd } from "../streaming.js";
import { AutomationEngineerAgent } from "../../agents/automationEngineer.js";
import { TestDesignerAgent } from "../../agents/testDesigner.js";
import { RequirementAnalystAgent } from "../../agents/requirementAnalyst.js";
import { fetchStory } from "../../ado/storyService.js";
import { getThreadState, setThreadState } from "../state.js";
import { analyzeFlakiness } from "../../skills/flakinessDetector.js";
import type { TestDesign } from "../../agents/types.js";

export const automationHandler: CopilotAgentHandler = {
  slug: "automation-engineer",
  name: "Automation Engineer",
  description: "Generate Playwright TypeScript tests with POM from test cases",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    try {
      let testDesign = getThreadState<TestDesign>(ctx.threadId, "testDesign");

      // If no test design, chain from the beginning
      if (!testDesign) {
        const storyId = extractStoryId(ctx.userMessage);
        if (!storyId) {
          streamText(ctx.res, "No prior test design found. Usage: `@qa-agent /generate <story-id>`\n\nOr run `/design` first.");
          endStream(ctx.res);
          return;
        }

        streamStatus(ctx.res, "requirement-analyst", `Analyzing story #${storyId}...`);
        const story = await fetchStory(storyId);
        const reqAgent = new RequirementAnalystAgent();
        const requirements = await reqAgent.analyze(story);
        setThreadState(ctx.threadId, "requirements", requirements);

        streamStatus(ctx.res, "test-designer", "Designing test cases...");
        const designer = new TestDesignerAgent();
        testDesign = await designer.design(requirements);
        setThreadState(ctx.threadId, "testDesign", testDesign);
      }

      const automatable = testDesign.testCases.filter((tc) => tc.automatable);
      streamStatus(ctx.res, "automation-engineer", `Generating Playwright tests for ${automatable.length} test cases...`);

      const engineer = new AutomationEngineerAgent();
      const result = await engineer.generate(testDesign);

      setThreadState(ctx.threadId, "automation", result);

      // Stream generated tests
      streamSection(ctx.res, `Generated ${result.tests.length} Test Files`, "");

      for (const test of result.tests) {
        // Flakiness pre-check
        const flakiness = analyzeFlakiness(test.code, test.fileName);
        const flakyBadge = flakiness.riskScore > 0.5 ? " ⚠️ HIGH FLAKINESS RISK" : flakiness.riskScore > 0.25 ? " ⚡ Needs attention" : " ✅ Stable";

        streamText(ctx.res, `\n#### 📄 ${test.fileName}${flakyBadge}\n`);
        streamCode(ctx.res, test.code);

        // Page Objects
        for (const po of test.pageObjects) {
          streamText(ctx.res, `\n##### Page Object: ${po.fileName}\n`);
          streamCode(ctx.res, po.code);
        }

        if (flakiness.reasons.length > 0) {
          streamText(ctx.res, `\n> Flakiness warnings: ${flakiness.reasons.join("; ")}\n`);
        }
      }

      if (result.fixtureCode) {
        streamText(ctx.res, `\n#### 🔧 Shared Fixture\n`);
        streamCode(ctx.res, result.fixtureCode);
      }

      streamText(ctx.res, `\n---\n_Tests ready. Use \`/run <story-id>\` to execute the full pipeline, or \`/review\` to run governance checks._\n`);

      endStream(ctx.res);
    } catch (err) {
      streamErrorAndEnd(ctx.res, `Test generation failed: ${(err as Error).message}`);
    }
  },
};

function extractStoryId(message: string): number | null {
  const match = message.match(/\b(\d{2,})\b/);
  return match ? parseInt(match[1], 10) : null;
}

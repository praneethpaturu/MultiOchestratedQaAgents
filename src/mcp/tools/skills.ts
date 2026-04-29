/**
 * MCP Tools: Skills
 *
 * Exposes the qa-agents skill library as first-class MCP tools any
 * agent can call. Each skill is a small reusable capability that
 * doesn't need an LLM call.
 *
 *   suggestHealedSelector — pick a stable replacement for a broken selector
 *   rankSelectorStability — score a selector on its likely durability (0-1)
 *   analyzeFlakiness      — flag risky patterns in a test file
 *   recordTestExecution   — feed pass/fail signal into the flakiness model
 */

import type { MCPToolDefinition, MCPToolHandler } from "../server.js";
import { suggestHealedSelector, rankSelectorStability } from "../../skills/locatorHealing.js";
import { analyzeFlakiness, recordTestExecution } from "../../skills/flakinessDetector.js";

export const skillsToolDefinitions: MCPToolDefinition[] = [
  {
    name: "suggestHealedSelector",
    description:
      "Given a broken Playwright selector, suggest a healed replacement using past selector_fix memory and stability heuristics. Returns null if no high-confidence suggestion is available.",
    inputSchema: {
      type: "object",
      properties: {
        brokenSelector: { type: "string", description: "The selector that just failed (e.g. \".btn-submit-v2\")" },
        pageContext: { type: "string", description: "Optional page name or context for narrowing" },
      },
      required: ["brokenSelector"],
    },
  },
  {
    name: "rankSelectorStability",
    description:
      "Score a Playwright selector's stability from 0 (very fragile) to 1 (very stable). Useful before committing to a selector strategy. data-testid > getByRole > getByLabel > CSS classes > nth-child.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "The selector to evaluate" },
      },
      required: ["selector"],
    },
  },
  {
    name: "analyzeFlakiness",
    description:
      "Static-analyse a Playwright test file for flakiness risk indicators (hardcoded waits, fragile selectors, race conditions, hardcoded dates, missing network waits). Returns risk score 0-1 and a list of reasons.",
    inputSchema: {
      type: "object",
      properties: {
        testCode: { type: "string", description: "Full source of the test file" },
        testName: { type: "string", description: "Name of the test for reporting" },
      },
      required: ["testCode", "testName"],
    },
  },
  {
    name: "recordTestExecution",
    description:
      "Feed a pass/fail observation into the flakiness model. Over time the model learns which tests fail intermittently and surfaces them as flaky.",
    inputSchema: {
      type: "object",
      properties: {
        testName: { type: "string" },
        passed: { type: "boolean" },
        durationMs: { type: "number" },
      },
      required: ["testName", "passed"],
    },
  },
];

export const skillsToolHandlers: Record<string, MCPToolHandler> = {
  async suggestHealedSelector(args) {
    const brokenSelector = args.brokenSelector as string;
    const pageContext = args.pageContext as string | undefined;
    const suggestion = suggestHealedSelector(brokenSelector, pageContext);
    return { suggestion };
  },

  async rankSelectorStability(args) {
    const selector = args.selector as string;
    const stability = rankSelectorStability(selector);
    return { selector, stability };
  },

  async analyzeFlakiness(args) {
    const testCode = args.testCode as string;
    const testName = args.testName as string;
    const report = analyzeFlakiness(testCode, testName);
    return report;
  },

  async recordTestExecution(args) {
    const testName = args.testName as string;
    const passed = args.passed as boolean;
    const durationMs = (args.durationMs as number) ?? 0;
    recordTestExecution(testName, passed, durationMs);
    return { recorded: true };
  },
};

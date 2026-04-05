/**
 * Copilot Extension — Command Router
 *
 * Parses the user's message to determine which agent handler
 * to invoke based on slash commands. Falls back to the
 * orchestrator for general messages.
 */

import type { CopilotAgentHandler, CopilotSkill } from "../types.js";
import { clarifierHandler } from "./clarifier.handler.js";
import { requirementHandler } from "./requirement.handler.js";
import { testDesignHandler } from "./testdesign.handler.js";
import { automationHandler } from "./automation.handler.js";
import { maintenanceHandler } from "./maintenance.handler.js";
import { rcaHandler } from "./rca.handler.js";
import { reviewerHandler } from "./reviewer.handler.js";
import { orchestratorHandler } from "./orchestrator.handler.js";

// ─── Handler Registry ───

const handlers = new Map<string, CopilotAgentHandler>();

function register(commands: string[], handler: CopilotAgentHandler): void {
  for (const cmd of commands) {
    handlers.set(cmd, handler);
  }
}

// Register all handlers with their slash commands
register(["/run", "/pipeline", "/execute"], orchestratorHandler);
register(["/clarify", "/questions"], clarifierHandler);
register(["/analyze", "/requirements", "/req"], requirementHandler);
register(["/design", "/testcases", "/tc"], testDesignHandler);
register(["/generate", "/automate", "/playwright"], automationHandler);
register(["/fix", "/maintain", "/repair"], maintenanceHandler);
register(["/rca", "/rootcause", "/diagnose"], rcaHandler);
register(["/review", "/governance", "/validate"], reviewerHandler);

// ─── Skill Definitions (for /help) ───

export const skills: CopilotSkill[] = [
  { command: "/run", description: "Execute full multi-agent QA pipeline", agentSlug: "orchestrator", usage: "@qa-agent /run 12345" },
  { command: "/clarify", description: "Check story for ambiguities", agentSlug: "clarifier", usage: "@qa-agent /clarify 12345" },
  { command: "/analyze", description: "Extract requirements and scenarios", agentSlug: "requirement-analyst", usage: "@qa-agent /analyze 12345" },
  { command: "/design", description: "Create prioritized test cases", agentSlug: "test-designer", usage: "@qa-agent /design 12345" },
  { command: "/generate", description: "Generate Playwright tests with POM", agentSlug: "automation-engineer", usage: "@qa-agent /generate 12345" },
  { command: "/fix", description: "Diagnose and fix broken tests", agentSlug: "maintenance", usage: "@qa-agent /fix (with error details)" },
  { command: "/rca", description: "Deep root cause analysis", agentSlug: "rca", usage: "@qa-agent /rca (with failure details)" },
  { command: "/review", description: "Governance review of pipeline output", agentSlug: "reviewer", usage: "@qa-agent /review" },
];

/**
 * Route a user message to the appropriate handler.
 * Extracts the first /command from the message.
 */
export function resolveHandler(userMessage: string): {
  handler: CopilotAgentHandler;
  cleanMessage: string;
} {
  const trimmed = userMessage.trim();

  // Check for slash command
  const cmdMatch = trimmed.match(/^\/(\w+)\b/);
  if (cmdMatch) {
    const cmd = `/${cmdMatch[1].toLowerCase()}`;
    const handler = handlers.get(cmd);
    if (handler) {
      return {
        handler,
        cleanMessage: trimmed.slice(cmdMatch[0].length).trim(),
      };
    }
  }

  // Check for natural language keywords
  const lower = trimmed.toLowerCase();
  if (lower.includes("run pipeline") || lower.includes("full pipeline") || lower.startsWith("run ")) {
    return { handler: orchestratorHandler, cleanMessage: trimmed };
  }
  if (lower.includes("clarif") || lower.includes("ambiguit")) {
    return { handler: clarifierHandler, cleanMessage: trimmed };
  }
  if (lower.includes("analy") || lower.includes("requirement")) {
    return { handler: requirementHandler, cleanMessage: trimmed };
  }
  if (lower.includes("design") || lower.includes("test case")) {
    return { handler: testDesignHandler, cleanMessage: trimmed };
  }
  if (lower.includes("generat") || lower.includes("playwright") || lower.includes("automat")) {
    return { handler: automationHandler, cleanMessage: trimmed };
  }
  if (lower.includes("fix") || lower.includes("maint") || lower.includes("repair")) {
    return { handler: maintenanceHandler, cleanMessage: trimmed };
  }
  if (lower.includes("rca") || lower.includes("root cause")) {
    return { handler: rcaHandler, cleanMessage: trimmed };
  }
  if (lower.includes("review") || lower.includes("governance")) {
    return { handler: reviewerHandler, cleanMessage: trimmed };
  }

  // Default to orchestrator
  return { handler: orchestratorHandler, cleanMessage: trimmed };
}

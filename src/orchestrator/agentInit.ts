/**
 * Agent Initializer — constructs all sub-agents so they self-register.
 *
 * Each agent's constructor calls registerAgent() in the base class,
 * which adds it to the global registry. The orchestrator then
 * discovers them dynamically via the registry.
 */

import { RequirementAnalystAgent } from "../agents/requirementAnalyst.js";
import { TestDesignerAgent } from "../agents/testDesigner.js";
import { AutomationEngineerAgent } from "../agents/automationEngineer.js";
import { MaintenanceAgent } from "../agents/maintenance.js";
import { RCAAgent } from "../agents/rca.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { ClarifierAgent } from "../agents/clarifier.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("AgentInit");
let initialized = false;

// Hold references so agents aren't garbage collected
const agentInstances: unknown[] = [];

export function initializeAgents(): void {
  if (initialized) return;

  log.info("Initializing Copilot agent team...");

  agentInstances.push(
    new ClarifierAgent(),
    new RequirementAnalystAgent(),
    new TestDesignerAgent(),
    new AutomationEngineerAgent(),
    new MaintenanceAgent(),
    new RCAAgent(),
    new ReviewerAgent()
  );

  initialized = true;
  log.info(`${agentInstances.length} agents registered and ready`);
}

/**
 * Agent Registry — Copilot-style dynamic agent discovery.
 *
 * All agents self-register on import. The orchestrator queries
 * the registry to discover available agents and their skills.
 */

import {
  AgentCard,
  AgentRequest,
  AgentResponse,
  LLMToolDefinition,
  agentToToolDefinitions,
} from "./protocol.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("Registry");

export interface RegisteredAgent {
  card: AgentCard;
  handler: (request: AgentRequest) => Promise<AgentResponse>;
}

const agents = new Map<string, RegisteredAgent>();

/**
 * Register a Copilot agent with its card and handler.
 */
export function registerAgent(
  card: AgentCard,
  handler: (request: AgentRequest) => Promise<AgentResponse>
): void {
  if (agents.has(card.slug)) {
    log.warn(`Agent @${card.slug} already registered — overwriting`);
  }
  agents.set(card.slug, { card, handler });
  log.info(`Registered agent: @${card.slug} (${card.skills.length} skills)`);
}

/**
 * Get a registered agent by slug.
 */
export function getAgent(slug: string): RegisteredAgent | undefined {
  return agents.get(slug);
}

/**
 * Get all registered agents.
 */
export function getAllAgents(): RegisteredAgent[] {
  return Array.from(agents.values());
}

/**
 * Get all non-orchestrator agents (sub-agents only).
 */
export function getSubAgents(): RegisteredAgent[] {
  return getAllAgents().filter((a) => !a.card.isOrchestrator);
}

/**
 * Build LLM tool definitions for all sub-agents.
 * Used by the orchestrator for function-calling.
 */
export function getAllToolDefinitions(): LLMToolDefinition[] {
  return getSubAgents().flatMap((a) => agentToToolDefinitions(a.card));
}

/**
 * Get a summary of all registered agents for display.
 */
export function getAgentManifest(): string {
  const lines: string[] = [];
  for (const { card } of getAllAgents()) {
    const prefix = card.isOrchestrator ? "🎯" : "🤖";
    lines.push(`${prefix} @${card.slug} — ${card.description}`);
    for (const skill of card.skills) {
      lines.push(`    ▸ ${skill.name}: ${skill.description}`);
    }
  }
  return lines.join("\n");
}

/**
 * Invoke a sub-agent by slug and skill name.
 */
export async function invokeAgent(
  slug: string,
  request: AgentRequest
): Promise<AgentResponse> {
  const agent = agents.get(slug);
  if (!agent) {
    throw new Error(`Agent @${slug} not found in registry. Available: ${Array.from(agents.keys()).join(", ")}`);
  }
  log.info(`Invoking @${slug}${request.skillName ? `.${request.skillName}` : ""}`);
  return agent.handler(request);
}

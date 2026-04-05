/**
 * GitHub Copilot Agent Protocol
 *
 * Defines the message format, agent cards, skill definitions,
 * and tool-call interface that all agents implement.
 * Modeled after the GitHub Copilot Extensions agent protocol.
 */

// ─── Agent Card (Copilot-style agent manifest) ───

export interface AgentCard {
  /** Unique agent identifier, used as @agent-name */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** One-line description shown in agent picker */
  description: string;
  /** Detailed description of capabilities */
  instructions: string;
  /** Skills this agent exposes as invocable tools */
  skills: SkillDefinition[];
  /** Whether this agent can invoke other agents */
  isOrchestrator: boolean;
}

export interface SkillDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
}

// ─── Agent Messages ───

export type AgentMessageRole = "user" | "agent" | "system" | "tool_result";

export interface AgentMessage {
  role: AgentMessageRole;
  agentSlug?: string;
  content: string;
  /** Structured data payload (JSON-serializable) */
  data?: unknown;
  timestamp: string;
}

// ─── Tool Calls (Orchestrator → Sub-Agent invocation) ───

export interface ToolCall {
  id: string;
  agentSlug: string;
  skillName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  agentSlug: string;
  success: boolean;
  content: string;
  data?: unknown;
}

// ─── Agent Request / Response ───

export interface AgentRequest {
  /** Conversation history leading to this request */
  messages: AgentMessage[];
  /** The specific skill being invoked (if targeted) */
  skillName?: string;
  /** Arguments passed to the skill */
  arguments?: Record<string, unknown>;
  /** Pipeline-level shared context */
  context: AgentContext;
}

export interface AgentContext {
  storyId?: number;
  conversationId: string;
  /** Accumulated state from prior agent invocations */
  state: Record<string, unknown>;
  /** Whether the orchestrator is running in interactive mode */
  interactive: boolean;
}

export interface AgentResponse {
  agentSlug: string;
  messages: AgentMessage[];
  /** Structured output data */
  data?: unknown;
  /** If the agent needs to invoke other agents (orchestrator only) */
  toolCalls?: ToolCall[];
  /** Whether this agent needs user input before continuing */
  needsUserInput: boolean;
  /** Questions for the user (via clarifier) */
  questions?: string[];
  /** Status of the agent's work */
  status: "complete" | "needs_input" | "needs_delegation" | "error";
}

// ─── Tool Definition (for LLM function-calling) ───

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

/**
 * Convert an AgentCard's skills into LLM tool definitions
 * that the orchestrator can use for function-calling.
 */
export function agentToToolDefinitions(card: AgentCard): LLMToolDefinition[] {
  return card.skills.map((skill) => ({
    type: "function" as const,
    function: {
      name: `${card.slug}__${skill.name}`,
      description: `[Agent: @${card.slug}] ${skill.description}`,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          skill.parameters.map((p) => [
            p.name,
            { type: p.type, description: p.description },
          ])
        ),
        required: skill.parameters
          .filter((p) => p.required)
          .map((p) => p.name),
      },
    },
  }));
}

/**
 * Parse a tool call name back into agent slug + skill name.
 */
export function parseToolCallName(name: string): {
  agentSlug: string;
  skillName: string;
} {
  const parts = name.split("__");
  return {
    agentSlug: parts[0],
    skillName: parts.slice(1).join("__"),
  };
}

/**
 * Create an AgentMessage helper.
 */
export function makeMessage(
  role: AgentMessageRole,
  content: string,
  agentSlug?: string,
  data?: unknown
): AgentMessage {
  return {
    role,
    agentSlug,
    content,
    data,
    timestamp: new Date().toISOString(),
  };
}

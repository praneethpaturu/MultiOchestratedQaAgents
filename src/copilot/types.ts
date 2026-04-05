/**
 * GitHub Copilot Extension Types
 *
 * Matches the wire format used by VS Code Copilot Chat
 * when communicating with a Copilot Extension agent.
 */

import type { Request, Response } from "express";

// ─── Copilot Request Payload ───

export interface CopilotRequestPayload {
  copilot_thread_id: string;
  messages: CopilotMessage[];
  stop: unknown;
  top_p: number;
  temperature: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  copilot_skills: unknown[];
  agent: string;
}

export interface CopilotMessage {
  role: "system" | "user" | "assistant";
  content: string;
  copilot_references?: CopilotReference[];
  copilot_confirmations?: CopilotConfirmation[];
  tool_calls?: CopilotToolCall[];
  name?: string;
  [key: string]: unknown;
}

export interface CopilotReference {
  type: string;
  id: string;
  data?: Record<string, unknown>;
  is_implicit?: boolean;
  metadata?: {
    display_name: string;
    display_icon?: string;
    display_url?: string;
  };
}

export interface CopilotConfirmation {
  state: "accepted" | "dismissed";
  confirmation: {
    id: string;
    [key: string]: unknown;
  };
}

export interface CopilotToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ─── Agent Handler Interface ───

export interface CopilotAgentContext {
  /** Parsed and verified request payload */
  payload: CopilotRequestPayload;
  /** GitHub API token from the user's session */
  token: string;
  /** The user's extracted message text */
  userMessage: string;
  /** The conversation thread ID */
  threadId: string;
  /** Express response for SSE streaming */
  res: Response;
  /** GitHub username of the invoking user */
  username?: string;
}

/**
 * Every Copilot agent handler must implement this interface.
 * Handlers stream SSE events directly to the response.
 */
export interface CopilotAgentHandler {
  /** Agent slug — used for routing (e.g., "orchestrator", "clarifier") */
  slug: string;
  /** Human-readable name */
  name: string;
  /** Description shown in help */
  description: string;
  /** Handle a Copilot Chat request by writing SSE events to ctx.res */
  handle(ctx: CopilotAgentContext): Promise<void>;
}

// ─── Skill Definition (for agent routing) ───

export interface CopilotSkill {
  /** Slash command name (e.g., "/analyze", "/design") */
  command: string;
  /** Description of what this skill does */
  description: string;
  /** The agent handler that owns this skill */
  agentSlug: string;
  /** Usage example shown in help */
  usage: string;
}

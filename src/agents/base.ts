import { AgentRole } from "../config/index.js";
import { routeToModel, LLMResponse } from "../utils/router.js";
import { agentLogger } from "../utils/logger.js";
import {
  AgentCard,
  AgentRequest,
  AgentResponse,
  makeMessage,
} from "./protocol.js";
import { registerAgent } from "./registry.js";
import winston from "winston";

/**
 * Base class for all Copilot-style agents.
 *
 * Each agent declares an AgentCard (manifest) with skills,
 * registers itself in the global registry on construction,
 * and implements a `handle()` method for the Copilot protocol.
 */
export abstract class BaseAgent {
  readonly name: string;
  readonly role: AgentRole;
  protected log: winston.Logger;

  constructor(name: string, role: AgentRole) {
    this.name = name;
    this.role = role;
    this.log = agentLogger(name);

    // Self-register in the agent registry
    const card = this.getAgentCard();
    registerAgent(card, (req) => this.handle(req));
  }

  /** Every agent must declare its Copilot agent card. */
  abstract getAgentCard(): AgentCard;

  /** Every agent must handle requests via the Copilot protocol. */
  abstract handle(request: AgentRequest): Promise<AgentResponse>;

  /** Convenience: build a successful AgentResponse. */
  protected success(content: string, data?: unknown): AgentResponse {
    return {
      agentSlug: this.getAgentCard().slug,
      messages: [makeMessage("agent", content, this.getAgentCard().slug, data)],
      data,
      needsUserInput: false,
      status: "complete",
    };
  }

  /** Convenience: build an error AgentResponse. */
  protected error(message: string): AgentResponse {
    return {
      agentSlug: this.getAgentCard().slug,
      messages: [makeMessage("agent", `Error: ${message}`, this.getAgentCard().slug)],
      needsUserInput: false,
      status: "error",
    };
  }

  /** Convenience: request user input. */
  protected needsInput(questions: string[]): AgentResponse {
    return {
      agentSlug: this.getAgentCard().slug,
      messages: [
        makeMessage(
          "agent",
          `I need clarification:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
          this.getAgentCard().slug
        ),
      ],
      needsUserInput: true,
      questions,
      status: "needs_input",
    };
  }

  /** Call the routed LLM for this agent's role. */
  protected async ask(
    systemPrompt: string,
    userPrompt: string,
    opts?: { temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    this.log.info("Sending request to LLM...");
    const response = await routeToModel({
      role: this.role,
      systemPrompt,
      userPrompt,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
    });
    this.log.info(
      `LLM responded (${response.usage?.completionTokens ?? "?"} tokens)`
    );
    return response;
  }
}

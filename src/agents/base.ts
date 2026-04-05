import { AgentRole } from "../config/index.js";
import { routeToModel, LLMResponse } from "../utils/router.js";
import { agentLogger } from "../utils/logger.js";
import winston from "winston";

export abstract class BaseAgent {
  readonly name: string;
  readonly role: AgentRole;
  protected log: winston.Logger;

  constructor(name: string, role: AgentRole) {
    this.name = name;
    this.role = role;
    this.log = agentLogger(name);
  }

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

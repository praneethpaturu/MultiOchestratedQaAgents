import { config, AgentRole } from "../config/index.js";
import { callLLM } from "./llm.js";
import { agentLogger } from "./logger.js";

const log = agentLogger("Router");

export interface LLMRequest {
  role: AgentRole;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Model-aware router: resolves the correct model for each agent role
 * and dispatches the LLM call through the appropriate provider.
 */
export async function routeToModel(request: LLMRequest): Promise<LLMResponse> {
  const model = config.models[request.role];
  const provider = resolveProvider(model);

  log.info(`Routing ${request.role} → ${model} (${provider})`);

  return callLLM({
    provider,
    model,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    temperature: request.temperature ?? config.llm.temperature,
    maxTokens: request.maxTokens ?? config.llm.maxTokens,
  });
}

function resolveProvider(model: string): "openai" | "anthropic" {
  if (model.startsWith("claude")) return "anthropic";
  return "openai";
}

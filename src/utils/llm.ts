import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/index.js";
import { LLMResponse } from "./router.js";
import { LLMToolDefinition } from "../agents/protocol.js";

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.llm.openaiApiKey });
  }
  return openaiClient;
}

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.llm.anthropicApiKey });
  }
  return anthropicClient;
}

export interface LLMCallParams {
  provider: "openai" | "anthropic";
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}

export async function callLLM(params: LLMCallParams): Promise<LLMResponse> {
  if (params.provider === "anthropic") {
    return callAnthropic(params);
  }
  return callOpenAI(params);
}

async function callOpenAI(params: LLMCallParams): Promise<LLMResponse> {
  const client = getOpenAI();
  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
  });

  const choice = response.choices[0];
  return {
    content: choice.message.content ?? "",
    model: response.model,
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
      : undefined,
  };
}

async function callAnthropic(params: LLMCallParams): Promise<LLMResponse> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return {
    content: textBlock?.type === "text" ? textBlock.text : "",
    model: response.model,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    },
  };
}

// ─── Tool-Calling Support (for Orchestrator agent) ───

export interface ToolCallResult {
  id: string;
  functionName: string;
  arguments: Record<string, unknown>;
}

export interface LLMWithToolsResponse extends LLMResponse {
  toolCalls?: ToolCallResult[];
  finishReason: "stop" | "tool_calls" | "length";
}

export interface LLMWithToolsParams extends LLMCallParams {
  tools: LLMToolDefinition[];
}

/**
 * Call LLM with function/tool definitions.
 * Used by the orchestrator to dynamically invoke sub-agents.
 */
export async function callLLMWithTools(
  params: LLMWithToolsParams
): Promise<LLMWithToolsResponse> {
  if (params.provider === "anthropic") {
    return callAnthropicWithTools(params);
  }
  return callOpenAIWithTools(params);
}

async function callOpenAIWithTools(
  params: LLMWithToolsParams
): Promise<LLMWithToolsResponse> {
  const client = getOpenAI();

  const tools: OpenAI.ChatCompletionTool[] = params.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    },
  }));

  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    tools,
    tool_choice: "auto",
  });

  const choice = response.choices[0];
  const toolCalls = choice.message.tool_calls?.map((tc) => ({
    id: tc.id,
    functionName: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }));

  return {
    content: choice.message.content ?? "",
    model: response.model,
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
      : undefined,
    toolCalls,
    finishReason: choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
  };
}

async function callAnthropicWithTools(
  params: LLMWithToolsParams
): Promise<LLMWithToolsResponse> {
  const client = getAnthropic();

  const tools: Anthropic.Tool[] = params.tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
    tools,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

  const toolCalls: ToolCallResult[] = toolUseBlocks.map((b) => {
    if (b.type !== "tool_use") throw new Error("Expected tool_use block");
    return {
      id: b.id,
      functionName: b.name,
      arguments: b.input as Record<string, unknown>,
    };
  });

  return {
    content: textBlock?.type === "text" ? textBlock.text : "",
    model: response.model,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    },
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: response.stop_reason === "tool_use" ? "tool_calls" : "stop",
  };
}

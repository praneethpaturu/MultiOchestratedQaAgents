import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/index.js";
import { LLMResponse } from "./router.js";

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

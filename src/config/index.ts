import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function env(key: string, fallback: string = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  ado: {
    org: env("ADO_ORG"),
    project: env("ADO_PROJECT"),
    token: env("ADO_TOKEN"),
    get baseUrl(): string {
      return `https://dev.azure.com/${this.org}/${this.project}`;
    },
    get apiBase(): string {
      return `${this.baseUrl}/_apis`;
    },
    apiVersion: "7.0",
  },

  models: {
    orchestrator: env("MODEL_ORCHESTRATOR", "gpt-4o"),
    clarifier: env("MODEL_CLARIFIER", "gpt-4o"),
    requirement: env("MODEL_REQUIREMENT", "gpt-4o"),
    testDesign: env("MODEL_TEST_DESIGN", "claude-sonnet-4-20250514"),
    automation: env("MODEL_AUTOMATION", "gpt-4o"),
    maintenance: env("MODEL_MAINTENANCE", "gpt-4o"),
    rca: env("MODEL_RCA", "claude-opus-4-20250514"),
    reviewer: env("MODEL_REVIEWER", "claude-opus-4-20250514"),
  },

  llm: {
    openaiApiKey: env("OPENAI_API_KEY"),
    anthropicApiKey: env("ANTHROPIC_API_KEY"),
    maxTokens: 4096,
    temperature: 0.2,
  },

  playwright: {
    baseUrl: env("BASE_URL", "https://example.com"),
    headless: env("HEADLESS", "true") === "true",
    timeout: 30_000,
    retries: 2,
    workers: 4,
  },

  memory: {
    dir: env("MEMORY_DIR", ".qa-memory"),
  },

  logging: {
    level: env("LOG_LEVEL", "info"),
    dir: env("LOG_DIR", "logs"),
  },

  pipeline: {
    maxMaintenanceRetries: 3,
    maxReviewerLoops: 3,
  },
} as const;

export type AgentRole = keyof typeof config.models;

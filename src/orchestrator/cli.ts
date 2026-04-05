import { Command } from "commander";
import { runEngine } from "./engine.js";
import { loadAllAgents } from "./agentLoader.js";
import { initMCPServer, listTools } from "../mcp/server.js";
import { clearMemory, queryMemory } from "../memory/store.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("qa-agent")
    .description(
      "Multi-Agent Orchestrated QA Platform — .md Copilot Agents + MCP Tools"
    )
    .version("3.0.0");

  // ─── Run: Full orchestrated pipeline ───
  program
    .command("run")
    .description("Run the full MCP-orchestrated QA pipeline for an ADO user story")
    .requiredOption("-s, --story-id <id>", "Azure DevOps story ID", parseInt)
    .option("--dry-run", "Generate tests but do not execute them")
    .option("--skip-tests", "Generate and write test files but skip execution")
    .action(async (opts) => {
      validateConfig();
      try {
        const state = await runEngine({
          storyId: opts.storyId,
          dryRun: opts.dryRun,
          skipTests: opts.skipTests,
        });

        if (state.reviewResult?.approved) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Pipeline failed: ${(error as Error).message}`);
        process.exit(2);
      }
    });

  // ─── Serve: Copilot Extension server ───
  program
    .command("serve")
    .description("Start the GitHub Copilot Extension server for VS Code")
    .option("-p, --port <port>", "Port number", "3000")
    .option("--skip-verify", "Skip GitHub signature verification (dev mode)")
    .action(async (opts) => {
      if (opts.skipVerify) process.env.COPILOT_SKIP_VERIFY = "true";
      process.env.PORT = opts.port;
      await import("../copilot/server.js");
    });

  // ─── MCP: Start stdio MCP server ───
  program
    .command("mcp")
    .description("Start the MCP server (stdio transport for VS Code)")
    .action(async () => {
      initMCPServer();
      const { startStdioTransport } = await import("../mcp/server.js");
      await startStdioTransport();
    });

  // ─── Agents: List loaded agents ───
  program
    .command("agents")
    .description("List all .md Copilot agent definitions and their MCP tools")
    .action(() => {
      const agents = loadAllAgents();
      console.log(`\nLoaded ${agents.length} Copilot Agents:\n`);
      for (const agent of agents) {
        console.log(`  📋 ${agent.name} (${agent.slug}.md)`);
        console.log(`     Model: ${agent.model}`);
        console.log(`     Tools: ${agent.mcpTools.join(", ") || "(none)"}`);
        console.log();
      }
    });

  // ─── Tools: List MCP tools ───
  program
    .command("tools")
    .description("List all registered MCP tools")
    .action(() => {
      initMCPServer();
      const tools = listTools();
      console.log(`\nMCP Tools (${tools.length}):\n`);
      for (const tool of tools) {
        console.log(`  🔧 ${tool.name}`);
        console.log(`     ${tool.description.slice(0, 100)}`);
        const params = Object.keys(tool.inputSchema.properties || {});
        if (params.length > 0) {
          console.log(`     Params: ${params.join(", ")}`);
        }
        console.log();
      }
    });

  // ─── Dashboard ───
  program
    .command("dashboard")
    .description("Start the QA dashboard web UI")
    .option("-p, --port <port>", "Port number", "4000")
    .action(async (opts) => {
      process.env.DASHBOARD_PORT = opts.port;
      await import("../dashboard/server.js");
    });

  // ─── Memory commands ───
  const memory = program
    .command("memory")
    .description("Manage the QA memory store");

  memory
    .command("list")
    .description("List memory entries")
    .option("-t, --type <type>", "Filter by type")
    .option("-n, --limit <n>", "Limit results", parseInt)
    .action((opts) => {
      const entries = queryMemory({
        type: opts.type,
        limit: opts.limit ?? 20,
      });
      if (entries.length === 0) {
        console.log("No memory entries found.");
        return;
      }
      console.log(`\nMemory entries (${entries.length}):\n`);
      for (const entry of entries) {
        console.log(
          `  [${entry.type}] ${entry.testName ?? entry.storyId ?? "—"} | ${entry.timestamp}`
        );
        console.log(`    ${JSON.stringify(entry.data).slice(0, 120)}`);
      }
    });

  memory
    .command("clear")
    .description("Clear all memory")
    .action(() => {
      clearMemory();
      console.log("Memory cleared.");
    });

  // ─── Config ───
  program
    .command("config")
    .description("Show current configuration")
    .action(() => {
      console.log("\nQA Agent Configuration:\n");
      console.log(`  ADO Org:     ${config.ado.org || "(not set)"}`);
      console.log(`  ADO Project: ${config.ado.project || "(not set)"}`);
      console.log(`  ADO Token:   ${config.ado.token ? "***" : "(not set)"}`);
      console.log();
      console.log("  Model Routing:");
      for (const [role, model] of Object.entries(config.models)) {
        console.log(`    ${role.padEnd(15)} → ${model}`);
      }
      console.log();
      console.log(`  Base URL:    ${config.playwright.baseUrl}`);
      console.log(`  Log Level:   ${config.logging.level}`);
    });

  return program;
}

function validateConfig(): void {
  const missing: string[] = [];
  if (!config.ado.org) missing.push("ADO_ORG");
  if (!config.ado.project) missing.push("ADO_PROJECT");
  if (!config.ado.token) missing.push("ADO_TOKEN");

  if (!config.llm.openaiApiKey && !config.llm.anthropicApiKey) {
    missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }

  if (missing.length > 0) {
    logger.error(
      `Missing: ${missing.join(", ")}\nCopy .env.example to .env and fill in values.`
    );
    process.exit(1);
  }
}

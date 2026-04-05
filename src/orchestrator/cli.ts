import { Command } from "commander";
import readline from "readline";
import { runPipeline, continuePipeline } from "./pipeline.js";
import { clearMemory, queryMemory } from "../memory/store.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initializeAgents } from "./agentInit.js";
import { getAgentManifest } from "../agents/registry.js";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("qa-agent")
    .description(
      "Multi-Agent Orchestrated QA Platform — GitHub Copilot agent protocol"
    )
    .version("2.0.0");

  // ─── Main command: run pipeline via orchestrator ───
  program
    .command("run")
    .description("Run the full orchestrated QA pipeline for an ADO user story")
    .requiredOption("-s, --story-id <id>", "Azure DevOps story ID", parseInt)
    .option("--dry-run", "Generate tests but do not execute them")
    .option("--skip-tests", "Generate and write test files but skip execution")
    .option("-i, --interactive", "Enable interactive mode (pause for clarification)")
    .action(async (opts) => {
      validateConfig();
      try {
        const ctx = await runPipeline({
          storyId: opts.storyId,
          dryRun: opts.dryRun,
          skipTests: opts.skipTests,
          interactive: opts.interactive,
        });

        if (ctx.reviewResult?.approved) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Pipeline failed: ${(error as Error).message}`);
        process.exit(2);
      }
    });

  // ─── Serve: Start Copilot Extension server ───
  program
    .command("serve")
    .description("Start the GitHub Copilot Extension server for VS Code")
    .option("-p, --port <port>", "Port number", "3000")
    .option("--skip-verify", "Skip GitHub signature verification (dev mode)")
    .action(async (opts) => {
      if (opts.skipVerify) {
        process.env.COPILOT_SKIP_VERIFY = "true";
      }
      process.env.PORT = opts.port;
      // Dynamic import to start the server
      await import("../copilot/server.js");
    });

  // ─── Agents command: list registered agents ───
  program
    .command("agents")
    .description("List all registered Copilot agents and their skills")
    .action(() => {
      initializeAgents();
      console.log("\nRegistered QA Agents:\n");
      console.log(getAgentManifest());
      console.log();
    });

  // ─── Interactive session ───
  program
    .command("interactive")
    .description("Start an interactive session with the orchestrator")
    .requiredOption("-s, --story-id <id>", "Azure DevOps story ID", parseInt)
    .action(async (opts) => {
      validateConfig();
      await runInteractiveSession(opts.storyId);
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

  // ─── Config command ───
  program
    .command("config")
    .description("Show current configuration and model routing")
    .action(() => {
      console.log("\nQA Agent Platform Configuration:\n");
      console.log(`  ADO Org:     ${config.ado.org || "(not set)"}`);
      console.log(`  ADO Project: ${config.ado.project || "(not set)"}`);
      console.log(`  ADO Token:   ${config.ado.token ? "***" : "(not set)"}`);
      console.log();
      console.log("  Model Routing (per agent):");
      for (const [role, model] of Object.entries(config.models)) {
        console.log(`    ${role.padEnd(15)} → ${model}`);
      }
      console.log();
      console.log(`  Base URL:    ${config.playwright.baseUrl}`);
      console.log(`  Headless:    ${config.playwright.headless}`);
      console.log(`  Log Level:   ${config.logging.level}`);
      console.log();
      console.log("  Pipeline Limits:");
      console.log(`    Max maintenance retries: ${config.pipeline.maxMaintenanceRetries}`);
      console.log(`    Max reviewer loops:      ${config.pipeline.maxReviewerLoops}`);
    });

  return program;
}

/**
 * Interactive session — orchestrator pauses for clarification
 * and the user answers questions in the terminal.
 */
async function runInteractiveSession(storyId: number): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  QA Agent — Interactive Orchestration Mode   ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`Story ID: ${storyId}`);
  console.log('Type "quit" at any prompt to exit.\n');

  try {
    // Run the pipeline in interactive mode
    const ctx = await runPipeline({
      storyId,
      interactive: true,
    });

    // If the pipeline paused for clarification, handle Q&A loop
    // (In the current implementation, this is handled by re-running with answers)

    console.log("\n──── Pipeline Complete ────");
    console.log(`  Review: ${ctx.reviewResult?.approved ? "APPROVED" : "REJECTED"}`);
    console.log(`  Score:  ${ctx.reviewResult?.score ?? "N/A"}/100`);
    console.log(`  Bugs:   ${ctx.bugs.length} filed`);
  } catch (error) {
    console.error(`\nPipeline error: ${(error as Error).message}`);
  } finally {
    rl.close();
  }
}

function validateConfig(): void {
  const missing: string[] = [];
  if (!config.ado.org) missing.push("ADO_ORG");
  if (!config.ado.project) missing.push("ADO_PROJECT");
  if (!config.ado.token) missing.push("ADO_TOKEN");

  const hasOpenAI = !!config.llm.openaiApiKey;
  const hasAnthropic = !!config.llm.anthropicApiKey;
  if (!hasOpenAI && !hasAnthropic) {
    missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");
  }

  if (missing.length > 0) {
    logger.error(
      `Missing required configuration: ${missing.join(", ")}\nCopy .env.example to .env and fill in the values.`
    );
    process.exit(1);
  }
}

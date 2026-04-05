import { Command } from "commander";
import { runPipeline } from "./pipeline.js";
import { clearMemory, queryMemory } from "../memory/store.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

export function createCLI(): Command {
  const program = new Command();

  program
    .name("qa-agent")
    .description(
      "Autonomous QA Agent — multi-agent test generation, execution, and governance"
    )
    .version("1.0.0");

  // ─── Main command: run pipeline ───
  program
    .command("run")
    .description("Run the full QA pipeline for an ADO user story")
    .requiredOption("-s, --story-id <id>", "Azure DevOps story ID", parseInt)
    .option("--dry-run", "Generate tests but do not execute them")
    .option("--skip-tests", "Generate and write test files but skip execution")
    .action(async (opts) => {
      validateConfig();
      try {
        const ctx = await runPipeline({
          storyId: opts.storyId,
          dryRun: opts.dryRun,
          skipTests: opts.skipTests,
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
    .description("Show current configuration")
    .action(() => {
      console.log("\nCurrent Configuration:\n");
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
      console.log(`  Headless:    ${config.playwright.headless}`);
      console.log(`  Log Level:   ${config.logging.level}`);
    });

  return program;
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

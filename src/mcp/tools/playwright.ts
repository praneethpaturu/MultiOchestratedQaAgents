/**
 * MCP Tools: Playwright
 *
 * generateTest — Generate Playwright test code from a test case spec
 * runTests — Execute Playwright tests and return results
 * getFailures — Parse and return failure details from the last run
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { MCPToolDefinition, MCPToolHandler } from "../server.js";
import { routeToModel } from "../../utils/router.js";
import { extractJSON } from "../../utils/helpers.js";

const PW_DIR = path.resolve(process.cwd(), "playwright");
const GEN_DIR = path.join(PW_DIR, "tests", "generated");
const PAGES_DIR = path.join(PW_DIR, "pages");
const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const RESULTS_FILE = path.join(REPORTS_DIR, "results.json");

// ─── Tool Definitions ───

export const playwrightToolDefinitions: MCPToolDefinition[] = [
  {
    name: "generateTest",
    description: "Generate a Playwright TypeScript test file from a test case specification. Uses POM pattern, stable selectors, and proper waits.",
    inputSchema: {
      type: "object",
      properties: {
        testCase: { type: "object", description: "Test case with id, title, steps, preconditions" },
        selectorHistory: { type: "array", description: "Past selector fixes for self-healing" },
        style: { type: "string", enum: ["pom", "fix"], description: "Generation style: pom (new) or fix (repair)" },
        fixInstructions: { type: "string", description: "For style=fix: what to fix" },
      },
      required: ["testCase"],
    },
  },
  {
    name: "runTests",
    description: "Execute all generated Playwright tests and return pass/fail results with failure details.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Playwright project name (chromium, firefox, webkit)" },
        grep: { type: "string", description: "Optional test name filter" },
      },
    },
  },
  {
    name: "getFailures",
    description: "Parse the latest Playwright test results and return detailed failure information including error messages, stack traces, and screenshots.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run identifier (default: latest)" },
      },
    },
  },
];

// ─── Tool Handlers ───

export const playwrightToolHandlers: Record<string, MCPToolHandler> = {
  async generateTest(args: Record<string, unknown>) {
    const testCase = args.testCase as Record<string, unknown>;
    const selectorHistory = (args.selectorHistory as unknown[]) ?? [];
    const style = (args.style as string) ?? "pom";
    const fixInstructions = args.fixInstructions as string;

    const systemPrompt = style === "fix"
      ? "You are a Playwright test repair specialist. Fix the test based on the instructions. Only change what's necessary. Return JSON with {tests: [{fileName, code, testCaseId, pageObjects: [{fileName, code}]}]}."
      : "You are an expert Playwright automation engineer. Generate production-quality tests using POM pattern, data-testid selectors, and proper waits. Return JSON with {tests: [{fileName, code, testCaseId, pageObjects: [{fileName, code}]}]}.";

    const healingHints = selectorHistory.length > 0
      ? `\nHistorical selector fixes:\n${(selectorHistory as any[]).slice(0, 5).map((s: any) => `- ${s.oldSelector} → ${s.newSelector}`).join("\n")}`
      : "";

    const userPrompt = style === "fix"
      ? `Fix this test:\n${JSON.stringify(testCase)}\n\nFix: ${fixInstructions}${healingHints}\n\nRespond with JSON only.`
      : `Generate Playwright test for:\n${JSON.stringify(testCase)}${healingHints}\n\nRespond with JSON only.`;

    const response = await routeToModel({
      role: "automation",
      systemPrompt,
      userPrompt,
      maxTokens: 6000,
    });

    const result = extractJSON<{ tests: unknown[] }>(response.content);

    // Write files to disk
    for (const dir of [GEN_DIR, PAGES_DIR, REPORTS_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    for (const test of result.tests as any[]) {
      fs.writeFileSync(path.join(GEN_DIR, test.fileName), test.code);
      for (const po of test.pageObjects ?? []) {
        fs.writeFileSync(path.join(PAGES_DIR, po.fileName), po.code);
      }
    }

    return result;
  },

  async runTests(args: Record<string, unknown>) {
    const project = args.project as string;
    const grep = args.grep as string;

    // Build args array to avoid shell injection
    const cmdArgs = ["playwright", "test", "--reporter=json,list"];
    if (project) cmdArgs.push(`--project=${project.replace(/[^a-zA-Z0-9_-]/g, "")}`);
    if (grep) cmdArgs.push(`--grep=${grep.replace(/[^a-zA-Z0-9_ .*?+[\]()-]/g, "")}`);

    for (const dir of [REPORTS_DIR]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    try {
      execSync(`npx ${cmdArgs.join(" ")}`, {
        cwd: PW_DIR,
        stdio: "pipe",
        timeout: 300_000,
        env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: RESULTS_FILE },
      });
      return { passed: true, failures: [] };
    } catch {
      const failures = parseFailures();
      return { passed: false, failures };
    }
  },

  async getFailures(args: Record<string, unknown>) {
    return { failures: parseFailures() };
  },
};

function parseFailures(): unknown[] {
  if (!fs.existsSync(RESULTS_FILE)) {
    return [{ testName: "unknown", errorMessage: "No results file — test runner may have crashed", errorStack: "", duration: 0 }];
  }

  const raw = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8"));
  const failures: unknown[] = [];

  function collect(suite: any) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status !== "passed" && result.status !== "skipped") {
            const screenshot = (result.attachments ?? []).find((a: any) => a.name === "screenshot");
            failures.push({
              testName: `${suite.title} > ${spec.title}`,
              fileName: suite.file ?? "unknown",
              errorMessage: result.error?.message ?? "Unknown error",
              errorStack: result.error?.stack ?? "",
              screenshotPath: screenshot?.path,
              duration: result.duration ?? 0,
            });
          }
        }
      }
    }
    for (const child of suite.suites ?? []) collect(child);
  }

  for (const suite of raw.suites ?? []) collect(suite);
  return failures;
}

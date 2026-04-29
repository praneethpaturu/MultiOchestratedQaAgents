/**
 * MCP Tools: Playwright
 *
 * generateTest      — Generate Playwright test code from a test case spec
 * runTests          — Execute Playwright tests and return results
 * getFailures       — Parse and return failure details from the last run
 * browserSnapshot   — Open a URL in a real browser and return the live
 *                     accessibility tree so agents can pick selectors
 *                     that actually exist on the page (no hallucinated
 *                     data-testid attributes).
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
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
  {
    name: "browserSnapshot",
    description:
      "Open a URL in a real Chromium browser and return the live accessibility tree (interactive elements with their roles, names, labels, and types) plus the page title. Use this BEFORE generating Playwright selectors so the selectors you choose actually exist on the page — never guess data-testid attributes that may not be there.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open (e.g. https://en.wikipedia.org)" },
        waitForSelector: { type: "string", description: "Optional selector to wait for before snapshotting" },
        maxElements: { type: "number", description: "Max interactive elements to return (default 50)" },
      },
      required: ["url"],
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

  async browserSnapshot(args: Record<string, unknown>) {
    const url = args.url as string;
    const waitForSelector = args.waitForSelector as string | undefined;
    const maxElements = (args.maxElements as number) ?? 50;
    if (!url) throw new Error("url is required");

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
      }

      const title = await page.title();
      const finalUrl = page.url();

      // Pull a flat list of interactive elements with their accessibility properties
      const elements = await page.evaluate((max: number) => {
        const out: Array<Record<string, unknown>> = [];
        const selector = "input, button, a, select, textarea, [role], [aria-label], [data-testid], [name], h1, h2, [contenteditable]";
        const nodes = Array.from(document.querySelectorAll(selector)).slice(0, max);
        for (const el of nodes) {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          const tag = node.tagName.toLowerCase();
          const explicitRole = node.getAttribute("role");
          let inferredRole: string | null = null;
          if (tag === "a" && (node as HTMLAnchorElement).href) inferredRole = "link";
          else if (tag === "button") inferredRole = "button";
          else if (tag === "h1" || tag === "h2") inferredRole = "heading";
          else if (tag === "input") {
            const t = (node as HTMLInputElement).type;
            inferredRole = t === "search" ? "searchbox" : t === "checkbox" ? "checkbox" : t === "radio" ? "radio" : t === "submit" || t === "button" ? "button" : "textbox";
          } else if (tag === "textarea") inferredRole = "textbox";
          else if (tag === "select") inferredRole = "combobox";
          out.push({
            tag,
            role: explicitRole ?? inferredRole,
            name: node.getAttribute("aria-label") ?? ((node.textContent ?? "").trim().slice(0, 80) || null),
            label: (node as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? null,
            placeholder: (node as HTMLInputElement).placeholder ?? null,
            type: (node as HTMLInputElement).type ?? null,
            inputName: (node as HTMLInputElement).name ?? null,
            id: node.id || null,
            testid: node.getAttribute("data-testid"),
            visible,
          });
        }
        return out;
      }, maxElements);

      return { url: finalUrl, title, elementCount: elements.length, elements };
    } finally {
      await browser.close();
    }
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

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { agentLogger } from "../utils/logger.js";
import { TestFailure, GeneratedTest } from "../agents/types.js";
import { addMemory } from "../memory/store.js";
import { recordTestExecution } from "../skills/flakinessDetector.js";

const log = agentLogger("TestRunner");

const PLAYWRIGHT_DIR = path.resolve(process.cwd(), "playwright");
const GENERATED_DIR = path.join(PLAYWRIGHT_DIR, "tests", "generated");
const PAGES_DIR = path.join(PLAYWRIGHT_DIR, "pages");
const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const RESULTS_FILE = path.join(REPORTS_DIR, "results.json");

/**
 * Write generated test files and page objects to disk.
 */
export function writeTestFiles(tests: GeneratedTest[], fixtureCode?: string): void {
  // Ensure directories
  for (const dir of [GENERATED_DIR, PAGES_DIR, REPORTS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Write fixture if provided
  if (fixtureCode) {
    fs.writeFileSync(
      path.join(PLAYWRIGHT_DIR, "fixtures", "generated.ts"),
      fixtureCode
    );
    log.info("Written shared fixture file");
  }

  for (const test of tests) {
    const testPath = path.join(GENERATED_DIR, test.fileName);
    fs.writeFileSync(testPath, normalizeTestCode(test.code));
    log.info(`Written test: ${test.fileName}`);

    for (const po of test.pageObjects) {
      const poPath = path.join(PAGES_DIR, po.fileName);
      fs.writeFileSync(poPath, normalizePageObjectCode(po.code));
      log.info(`Written page object: ${po.fileName}`);
    }
  }
}

function normalizeTestCode(code: string): string {
  return code.replace(/from\s+['"](\.\.\/)+pages\//g, "from '../../pages/");
}

function normalizePageObjectCode(code: string): string {
  const usesExpect = /\bexpect\s*\(/.test(code);
  const importsExpect = /import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]@playwright\/test['"]/.test(code);
  if (usesExpect && !importsExpect) {
    return code.replace(
      /import\s*\{([^}]+)\}\s*from\s*(['"])@playwright\/test\2/,
      (_m, names, quote) => `import { ${names.trim()}, expect } from ${quote}@playwright/test${quote}`
    );
  }
  return code;
}

/**
 * Run Playwright tests and return failures.
 */
export function runTests(): TestFailure[] {
  log.info("Running Playwright tests...");

  try {
    execSync("npx playwright test --reporter=json,list", {
      cwd: PLAYWRIGHT_DIR,
      stdio: "pipe",
      timeout: 300_000, // 5 min max
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: RESULTS_FILE },
    });
    log.info("All tests passed!");
    processResults(true);
    return [];
  } catch (error) {
    log.warn("Some tests failed. Analyzing results...");
    return parseFailures();
  }
}

function parseFailures(): TestFailure[] {
  if (!fs.existsSync(RESULTS_FILE)) {
    log.error("No results file found. Test run may have crashed.");
    return [
      {
        testName: "unknown",
        fileName: "unknown",
        errorMessage: "Test runner crashed — no results file produced",
        errorStack: "",
        duration: 0,
      },
    ];
  }

  const raw = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8"));
  const failures: TestFailure[] = [];

  for (const suite of raw.suites ?? []) {
    collectFailures(suite, failures);
  }

  processResults(false, failures);
  return failures;
}

function collectFailures(suite: any, failures: TestFailure[]): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        const passed = result.status === "passed" || result.status === "skipped";
        const testName = `${suite.title} > ${spec.title}`;

        recordTestExecution(testName, passed, result.duration ?? 0);

        if (!passed) {
          const attachments = result.attachments ?? [];
          const screenshot = attachments.find(
            (a: any) => a.name === "screenshot"
          );

          failures.push({
            testName,
            fileName: suite.file ?? "unknown",
            errorMessage: result.error?.message ?? "Unknown error",
            errorStack: result.error?.stack ?? "",
            screenshotPath: screenshot?.path,
            duration: result.duration ?? 0,
          });

          addMemory({
            type: "failure",
            testName,
            data: {
              failed: true,
              error: (result.error?.message ?? "").slice(0, 200),
              duration: result.duration,
            },
          });
        }
      }
    }
  }

  // Recurse into sub-suites
  for (const child of suite.suites ?? []) {
    collectFailures(child, failures);
  }
}

function processResults(allPassed: boolean, failures?: TestFailure[]): void {
  if (allPassed) {
    log.info("Test execution: ALL PASSED");
  } else {
    log.warn(`Test execution: ${failures?.length ?? 0} failure(s)`);
  }
}

/**
 * Read the current test code for a given file name.
 */
export function readTestCode(fileName: string): string {
  const testPath = path.join(GENERATED_DIR, fileName);
  if (fs.existsSync(testPath)) {
    return fs.readFileSync(testPath, "utf-8");
  }
  // Also check pages
  const pagePath = path.join(PAGES_DIR, fileName);
  if (fs.existsSync(pagePath)) {
    return fs.readFileSync(pagePath, "utf-8");
  }
  return "";
}

/**
 * Update a test file with fixed code.
 */
export function updateTestFile(fileName: string, code: string): void {
  const testPath = path.join(GENERATED_DIR, fileName);
  fs.writeFileSync(testPath, code);
  log.info(`Updated test file: ${fileName}`);
}

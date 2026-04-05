import { config } from "../config/index.js";
import { agentLogger } from "../utils/logger.js";
import { fetchStory } from "../ado/storyService.js";
import { createBug, BugReport } from "../ado/bugService.js";
import {
  RequirementAnalystAgent,
  TestDesignerAgent,
  AutomationEngineerAgent,
  MaintenanceAgent,
  RCAAgent,
  ReviewerAgent,
} from "../agents/index.js";
import {
  PipelineContext,
  TestFailure,
  RCAResult,
  ReviewResult,
} from "../agents/types.js";
import {
  writeTestFiles,
  runTests,
  readTestCode,
  updateTestFile,
} from "./testRunner.js";
import { analyzeFlakiness } from "../skills/flakinessDetector.js";

const log = agentLogger("Pipeline");

export interface PipelineOptions {
  storyId: number;
  skipTests?: boolean;
  dryRun?: boolean;
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineContext> {
  const { storyId, skipTests, dryRun } = options;

  log.info(`========================================`);
  log.info(`  QA Agent Pipeline — Story #${storyId}`);
  log.info(`========================================`);

  // Initialize agents
  const reqAgent = new RequirementAnalystAgent();
  const designAgent = new TestDesignerAgent();
  const autoAgent = new AutomationEngineerAgent();
  const maintAgent = new MaintenanceAgent();
  const rcaAgent = new RCAAgent();
  const reviewerAgent = new ReviewerAgent();

  // Initialize context
  const ctx: PipelineContext = {
    storyId,
    storyTitle: "",
    failures: [],
    rcaResults: [],
    bugs: [],
    maintenanceAttempts: 0,
    reviewerLoops: 0,
  };

  try {
    // ─── STEP 1: Fetch Story ───
    log.info("STEP 1: Fetching user story from ADO...");
    const story = await fetchStory(storyId);
    ctx.storyTitle = story.title;
    log.info(`Story: "${story.title}" [${story.state}]`);

    // ─── STEP 2: Requirement Analysis ───
    log.info("STEP 2: Analyzing requirements...");
    ctx.requirements = await reqAgent.analyze(story);
    log.info(
      `Extracted ${ctx.requirements.scenarios.length} scenarios, ${ctx.requirements.edgeCases.length} edge cases`
    );

    // ─── STEP 3: Test Design ───
    log.info("STEP 3: Designing test cases...");
    ctx.testDesign = await designAgent.design(ctx.requirements);
    log.info(`Designed ${ctx.testDesign.testCases.length} test cases`);

    // ─── STEP 4: Automation ───
    log.info("STEP 4: Generating Playwright tests...");
    ctx.automation = await autoAgent.generate(ctx.testDesign);
    log.info(`Generated ${ctx.automation.tests.length} test file(s)`);

    // Run flakiness analysis on generated code
    for (const test of ctx.automation.tests) {
      const report = analyzeFlakiness(test.code, test.fileName);
      if (report.riskScore > 0.25) {
        log.warn(
          `Flakiness risk: ${test.fileName} — ${report.recommendation} (${(report.riskScore * 100).toFixed(0)}%)`
        );
      }
    }

    if (dryRun) {
      log.info("DRY RUN: Writing test files but skipping execution.");
      writeTestFiles(ctx.automation.tests, ctx.automation.fixtureCode);
      return ctx;
    }

    if (skipTests) {
      log.info("SKIP TESTS: Writing files only.");
      writeTestFiles(ctx.automation.tests, ctx.automation.fixtureCode);
      return ctx;
    }

    // ─── STEP 5: Write & Run Tests ───
    log.info("STEP 5: Writing and executing tests...");
    writeTestFiles(ctx.automation.tests, ctx.automation.fixtureCode);
    ctx.failures = runTests();

    if (ctx.failures.length === 0) {
      log.info("All tests passed on first run!");
    }

    // ─── STEP 6: Maintenance Loop ───
    while (
      ctx.failures.length > 0 &&
      ctx.maintenanceAttempts < config.pipeline.maxMaintenanceRetries
    ) {
      ctx.maintenanceAttempts++;
      log.info(
        `STEP 6: Maintenance attempt ${ctx.maintenanceAttempts}/${config.pipeline.maxMaintenanceRetries}...`
      );

      await runMaintenanceCycle(ctx, maintAgent, autoAgent);
      ctx.failures = runTests();

      if (ctx.failures.length === 0) {
        log.info(
          `All tests passed after maintenance attempt #${ctx.maintenanceAttempts}`
        );
        break;
      }
    }

    // ─── STEP 7: RCA (if still failing) ───
    if (ctx.failures.length > 0) {
      log.info("STEP 7: Running Root Cause Analysis...");
      await runRCACycle(ctx, rcaAgent, autoAgent, storyId);
    }

    // ─── STEP 8: Reviewer Loop ───
    let reviewApproved = false;
    while (
      !reviewApproved &&
      ctx.reviewerLoops < config.pipeline.maxReviewerLoops
    ) {
      log.info(
        `STEP 8: Reviewer pass ${ctx.reviewerLoops + 1}/${config.pipeline.maxReviewerLoops}...`
      );
      ctx.reviewResult = await reviewerAgent.review(ctx);
      ctx.reviewerLoops++;

      if (ctx.reviewResult.approved) {
        reviewApproved = true;
        log.info(
          `APPROVED by reviewer (score: ${ctx.reviewResult.score}/100)`
        );
      } else {
        log.warn(
          `REJECTED by reviewer (score: ${ctx.reviewResult.score}/100)`
        );
        if (ctx.reviewerLoops < config.pipeline.maxReviewerLoops) {
          await applyReviewerFeedback(ctx, autoAgent);
        }
      }
    }

    // ─── DONE ───
    logPipelineSummary(ctx);
    return ctx;
  } catch (error) {
    log.error(`Pipeline failed: ${(error as Error).message}`);
    throw error;
  }
}

async function runMaintenanceCycle(
  ctx: PipelineContext,
  maintAgent: MaintenanceAgent,
  autoAgent: AutomationEngineerAgent
): Promise<void> {
  // Group failures by file
  const byFile = new Map<string, TestFailure[]>();
  for (const f of ctx.failures) {
    const existing = byFile.get(f.fileName) ?? [];
    existing.push(f);
    byFile.set(f.fileName, existing);
  }

  for (const [fileName, failures] of byFile) {
    const testCode = readTestCode(fileName);
    if (!testCode) {
      log.warn(`Cannot read test file: ${fileName}`);
      continue;
    }

    const fixes = await maintAgent.diagnoseAndFix(failures, testCode);
    for (const fix of fixes) {
      updateTestFile(fix.fileName, fix.fixedCode);
    }
  }
}

async function runRCACycle(
  ctx: PipelineContext,
  rcaAgent: RCAAgent,
  autoAgent: AutomationEngineerAgent,
  storyId: number
): Promise<void> {
  // Gather all test code for context
  const allCode = ctx.failures
    .map((f) => `// ${f.fileName}\n${readTestCode(f.fileName)}`)
    .join("\n\n");

  ctx.rcaResults = await rcaAgent.analyze(
    ctx.failures,
    allCode,
    ctx.maintenanceAttempts
  );

  for (const result of ctx.rcaResults) {
    const action = RCAAgent.decideAction(result);
    log.info(
      `RCA Decision: ${result.testName} → ${action} (${result.category})`
    );

    switch (action) {
      case "create_bug":
        await createBugFromRCA(result, storyId, ctx);
        break;

      case "fix_test": {
        // Send back to automation agent for targeted fix
        const test = ctx.automation?.tests.find(
          (t) =>
            t.fileName === result.testName ||
            result.testName.includes(t.testCaseId)
        );
        if (test) {
          const fixedTest = await autoAgent.applyFix(
            test,
            result.suggestedFix,
            result.errorLog
          );
          updateTestFile(fixedTest.fileName, fixedTest.code);
          for (const po of fixedTest.pageObjects) {
            updateTestFile(po.fileName, po.code);
          }
        }
        break;
      }

      case "flag_infra":
        log.warn(
          `INFRASTRUCTURE ISSUE: ${result.testName} — ${result.rootCause}`
        );
        log.warn("Manual intervention may be required.");
        break;

      case "retry":
        log.info(`Will retry: ${result.testName}`);
        break;
    }
  }
}

async function createBugFromRCA(
  result: RCAResult,
  storyId: number,
  ctx: PipelineContext
): Promise<void> {
  const failure = ctx.failures.find(
    (f) => f.testName === result.testName
  );

  const bugReport: BugReport = {
    title: `[Auto-QA] ${result.category}: ${result.rootCause.slice(0, 100)}`,
    description: result.details,
    stepsToReproduce: `1. Run automated test: ${result.testName}\n2. Observe failure\n\nAutomated detection by QA Agent RCA system.`,
    expectedResult: "Test should pass according to user story acceptance criteria",
    actualResult: failure?.errorMessage ?? result.rootCause,
    errorLogs: result.errorLog.slice(0, 3000),
    screenshotPath: failure?.screenshotPath,
    testCaseRef: result.testName,
    rcaSummary: `Category: ${result.category}\nConfidence: ${result.confidence}\nRoot Cause: ${result.rootCause}\nSuggested Fix: ${result.suggestedFix}`,
    rootCause: result.rootCause,
    severity:
      result.confidence > 0.8
        ? "2 - High"
        : result.confidence > 0.5
          ? "3 - Medium"
          : "4 - Low",
    parentStoryId: storyId,
  };

  const createdBug = await createBug(bugReport);
  if (createdBug) {
    ctx.bugs.push(createdBug);
    log.info(`Bug created: #${createdBug.id}`);
  }
}

async function applyReviewerFeedback(
  ctx: PipelineContext,
  autoAgent: AutomationEngineerAgent
): Promise<void> {
  if (!ctx.reviewResult || !ctx.automation) return;

  const blockers = ctx.reviewResult.issues.filter(
    (i) => i.severity === "blocker" || i.severity === "major"
  );
  if (blockers.length === 0) return;

  log.info(`Applying ${blockers.length} reviewer fix(es)...`);

  for (const issue of blockers) {
    const affectedTest = ctx.automation.tests.find(
      (t) =>
        issue.location?.includes(t.fileName) ||
        issue.location?.includes(t.testCaseId)
    );
    if (affectedTest) {
      const fixed = await autoAgent.applyFix(
        affectedTest,
        `Reviewer feedback: ${issue.description}\nSuggestion: ${issue.suggestion}`,
        ""
      );
      updateTestFile(fixed.fileName, fixed.code);
    }
  }
}

function logPipelineSummary(ctx: PipelineContext): void {
  log.info(`\n========================================`);
  log.info(`  PIPELINE COMPLETE — Story #${ctx.storyId}`);
  log.info(`========================================`);
  log.info(`  Story: ${ctx.storyTitle}`);
  log.info(
    `  Scenarios: ${ctx.requirements?.scenarios.length ?? 0}`
  );
  log.info(`  Test Cases: ${ctx.testDesign?.testCases.length ?? 0}`);
  log.info(`  Test Files: ${ctx.automation?.tests.length ?? 0}`);
  log.info(`  Failures: ${ctx.failures.length}`);
  log.info(`  Maintenance attempts: ${ctx.maintenanceAttempts}`);
  log.info(`  RCA results: ${ctx.rcaResults.length}`);
  log.info(`  Bugs filed: ${ctx.bugs.length}`);
  log.info(
    `  Review: ${ctx.reviewResult?.approved ? "APPROVED" : "REJECTED"} (score: ${ctx.reviewResult?.score ?? "N/A"})`
  );
  log.info(`========================================\n`);
}

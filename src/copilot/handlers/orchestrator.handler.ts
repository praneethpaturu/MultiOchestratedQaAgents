/**
 * @qa-agent /run — Copilot Extension Orchestrator Handler
 *
 * The central brain. Executes the full multi-agent pipeline
 * for a given story ID, streaming progress to VS Code Copilot Chat.
 *
 * Flow: Clarify → Analyze → Design → Generate → Execute → Maintain → RCA → Review
 */

import type { CopilotAgentHandler, CopilotAgentContext } from "../types.js";
import {
  initSSE,
  streamText,
  streamSection,
  streamStatus,
  streamStep,
  streamCode,
  streamReferences,
  streamConfirmation,
  streamError,
  endStream,
  streamErrorAndEnd,
} from "../streaming.js";
import { setThreadState } from "../state.js";

// Agents
import { ClarifierAgent } from "../../agents/clarifier.js";
import { RequirementAnalystAgent } from "../../agents/requirementAnalyst.js";
import { TestDesignerAgent } from "../../agents/testDesigner.js";
import { AutomationEngineerAgent } from "../../agents/automationEngineer.js";
import { MaintenanceAgent } from "../../agents/maintenance.js";
import { RCAAgent } from "../../agents/rca.js";
import { ReviewerAgent } from "../../agents/reviewer.js";

// Services
import { fetchStory } from "../../ado/storyService.js";
import { createBug, BugReport } from "../../ado/bugService.js";
import { writeTestFiles, runTests, readTestCode, updateTestFile } from "../../orchestrator/testRunner.js";
import { analyzeFlakiness } from "../../skills/flakinessDetector.js";
import { config } from "../../config/index.js";
import type { PipelineContext, TestFailure, RCAResult, AutomationResult } from "../../agents/types.js";

const TOTAL_STEPS = 8;

export const orchestratorHandler: CopilotAgentHandler = {
  slug: "orchestrator",
  name: "Orchestrator Agent",
  description: "Execute the full multi-agent QA pipeline for an ADO user story",

  async handle(ctx: CopilotAgentContext): Promise<void> {
    initSSE(ctx.res);

    const storyId = extractStoryId(ctx.userMessage);
    if (!storyId) {
      streamText(ctx.res, "Please provide a story ID: `@qa-agent /run <story-id>`\n");
      endStream(ctx.res);
      return;
    }

    const dryRun = ctx.userMessage.includes("--dry-run");

    const pCtx: PipelineContext = {
      storyId,
      storyTitle: "",
      failures: [],
      rcaResults: [],
      bugs: [],
      maintenanceAttempts: 0,
      reviewerLoops: 0,
    };

    try {
      streamSection(ctx.res, `QA Pipeline — Story #${storyId}`, dryRun ? "_Dry run mode — tests will not be executed_\n" : "");

      // ── STEP 1: Fetch Story ──
      streamStep(ctx.res, 1, TOTAL_STEPS, "Fetching user story from Azure DevOps");
      const story = await fetchStory(storyId);
      pCtx.storyTitle = story.title;

      if (story.url) {
        streamReferences(ctx.res, [{
          type: "issue",
          id: `story-${storyId}`,
          title: `#${storyId}: ${story.title}`,
          url: story.url,
          icon: "issue-opened",
        }]);
      }
      streamStatus(ctx.res, "orchestrator", `Story: "${story.title}" [${story.state}]`);

      // ── STEP 2: Clarification ──
      streamStep(ctx.res, 2, TOTAL_STEPS, "Checking for ambiguities (@clarifier)");
      const clarifier = new ClarifierAgent();
      const clarity = await clarifier.analyzeClarity(story);

      if (clarity.needsClarification) {
        streamStatus(ctx.res, "clarifier", `${clarity.questions.length} question(s) identified — proceeding with default assumptions`);
        for (const q of clarity.questions) {
          streamText(ctx.res, `> **${q.id}:** ${q.question} → _Assuming: ${q.defaultAssumption}_\n`);
        }
      } else {
        streamStatus(ctx.res, "clarifier", "Requirements are clear ✓");
      }

      // ── STEP 3: Requirement Analysis ──
      streamStep(ctx.res, 3, TOTAL_STEPS, "Extracting requirements (@requirement-analyst)");
      const reqAgent = new RequirementAnalystAgent();
      pCtx.requirements = await reqAgent.analyze(story);
      setThreadState(ctx.threadId, "requirements", pCtx.requirements);
      streamStatus(ctx.res, "requirement-analyst",
        `${pCtx.requirements.scenarios.length} scenarios, ${pCtx.requirements.edgeCases.length} edge cases`);

      // ── STEP 4: Test Design ──
      streamStep(ctx.res, 4, TOTAL_STEPS, "Designing test cases (@test-designer)");
      const designer = new TestDesignerAgent();
      pCtx.testDesign = await designer.design(pCtx.requirements);
      setThreadState(ctx.threadId, "testDesign", pCtx.testDesign);
      const automatable = pCtx.testDesign.testCases.filter((tc) => tc.automatable);
      streamStatus(ctx.res, "test-designer",
        `${pCtx.testDesign.testCases.length} test cases (${automatable.length} automatable)`);

      // ── STEP 5: Automation ──
      streamStep(ctx.res, 5, TOTAL_STEPS, "Generating Playwright tests (@automation-engineer)");
      const engineer = new AutomationEngineerAgent();
      pCtx.automation = await engineer.generate(pCtx.testDesign);
      setThreadState(ctx.threadId, "automation", pCtx.automation);

      // Flakiness pre-check
      for (const test of pCtx.automation.tests) {
        const report = analyzeFlakiness(test.code, test.fileName);
        if (report.riskScore > 0.25) {
          streamText(ctx.res, `> ⚡ Flakiness risk: \`${test.fileName}\` — ${report.recommendation}\n`);
        }
      }
      streamStatus(ctx.res, "automation-engineer",
        `${pCtx.automation.tests.length} test file(s) generated`);

      // Write test files
      writeTestFiles(pCtx.automation.tests, pCtx.automation.fixtureCode);

      if (dryRun) {
        streamText(ctx.res, `\n**Dry run complete.** Tests written to disk but not executed.\n`);
        endStream(ctx.res);
        return;
      }

      // ── STEP 6: Execute & Maintain ──
      streamStep(ctx.res, 6, TOTAL_STEPS, "Running Playwright tests");
      pCtx.failures = runTests();

      if (pCtx.failures.length === 0) {
        streamStatus(ctx.res, "orchestrator", "All tests passed on first run ✓");
      } else {
        streamStatus(ctx.res, "orchestrator", `${pCtx.failures.length} failure(s) — entering maintenance loop`);

        while (
          pCtx.failures.length > 0 &&
          pCtx.maintenanceAttempts < config.pipeline.maxMaintenanceRetries
        ) {
          pCtx.maintenanceAttempts++;
          streamStatus(ctx.res, "maintenance",
            `Fix attempt ${pCtx.maintenanceAttempts}/${config.pipeline.maxMaintenanceRetries}...`);

          const maintAgent = new MaintenanceAgent();
          const byFile = groupByFile(pCtx.failures);

          for (const [fileName, failures] of byFile) {
            const testCode = readTestCode(fileName);
            if (!testCode) continue;
            const fixes = await maintAgent.diagnoseAndFix(failures, testCode);
            for (const fix of fixes) {
              updateTestFile(fix.fileName, fix.fixedCode);
            }
          }

          pCtx.failures = runTests();
          if (pCtx.failures.length === 0) {
            streamStatus(ctx.res, "maintenance", `All tests passing after attempt #${pCtx.maintenanceAttempts} ✓`);
            break;
          }
        }
      }

      // ── STEP 7: RCA ──
      if (pCtx.failures.length > 0) {
        streamStep(ctx.res, 7, TOTAL_STEPS, "Root cause analysis (@rca)");
        const rcaAgent = new RCAAgent();
        const allCode = pCtx.failures.map((f) => readTestCode(f.fileName)).join("\n\n");
        pCtx.rcaResults = await rcaAgent.analyze(pCtx.failures, allCode, pCtx.maintenanceAttempts);
        setThreadState(ctx.threadId, "rcaResults", pCtx.rcaResults);

        for (const result of pCtx.rcaResults) {
          const action = RCAAgent.decideAction(result);
          streamText(ctx.res, `> **${result.testName}:** \`${result.category}\` (${(result.confidence * 100).toFixed(0)}%) → ${action}\n`);

          if (action === "create_bug") {
            const bug = await createBugFromRCA(result, pCtx);
            if (bug) {
              pCtx.bugs.push(bug);
              streamReferences(ctx.res, [{
                type: "issue",
                id: `bug-${bug.id}`,
                title: `Bug #${bug.id}`,
                url: bug.url,
                icon: "bug",
              }]);
            }
          } else if (action === "fix_test") {
            const test = pCtx.automation?.tests.find(
              (t) => t.fileName === result.testName || result.testName.includes(t.testCaseId)
            );
            if (test) {
              const fixed = await engineer.applyFix(test, result.suggestedFix, result.errorLog);
              updateTestFile(fixed.fileName, fixed.code);
            }
          }
        }
      } else {
        streamStep(ctx.res, 7, TOTAL_STEPS, "RCA — not needed (all tests passing)");
      }

      // ── STEP 8: Reviewer ──
      streamStep(ctx.res, 8, TOTAL_STEPS, "Governance review (@reviewer)");
      const reviewer = new ReviewerAgent();
      let approved = false;

      while (!approved && pCtx.reviewerLoops < config.pipeline.maxReviewerLoops) {
        pCtx.reviewResult = await reviewer.review(pCtx);
        pCtx.reviewerLoops++;

        if (pCtx.reviewResult.approved) {
          approved = true;
          streamStatus(ctx.res, "reviewer", `✅ APPROVED (score: ${pCtx.reviewResult.score}/100)`);
        } else {
          streamStatus(ctx.res, "reviewer",
            `❌ REJECTED (score: ${pCtx.reviewResult.score}/100, ${pCtx.reviewResult.issues.length} issues)`);

          if (pCtx.reviewerLoops < config.pipeline.maxReviewerLoops) {
            // Apply feedback
            const blockers = pCtx.reviewResult.issues.filter(
              (i) => i.severity === "blocker" || i.severity === "major"
            );
            for (const issue of blockers) {
              const test = pCtx.automation?.tests.find(
                (t) => issue.location?.includes(t.fileName)
              );
              if (test) {
                const fixed = await engineer.applyFix(
                  test,
                  `Reviewer: ${issue.description} — ${issue.suggestion}`,
                  ""
                );
                updateTestFile(fixed.fileName, fixed.code);
              }
            }
          }
        }
      }

      setThreadState(ctx.threadId, "bugs", pCtx.bugs);
      setThreadState(ctx.threadId, "failures", pCtx.failures);

      // ── SUMMARY ──
      streamSection(ctx.res, "Pipeline Summary", "");
      streamText(ctx.res, `| Metric | Value |\n|---|---|\n`);
      streamText(ctx.res, `| **Story** | #${pCtx.storyId}: ${pCtx.storyTitle} |\n`);
      streamText(ctx.res, `| **Scenarios** | ${pCtx.requirements?.scenarios.length ?? 0} |\n`);
      streamText(ctx.res, `| **Test Cases** | ${pCtx.testDesign?.testCases.length ?? 0} |\n`);
      streamText(ctx.res, `| **Test Files** | ${pCtx.automation?.tests.length ?? 0} |\n`);
      streamText(ctx.res, `| **Failures** | ${pCtx.failures.length} |\n`);
      streamText(ctx.res, `| **Maintenance Attempts** | ${pCtx.maintenanceAttempts} |\n`);
      streamText(ctx.res, `| **RCA Results** | ${pCtx.rcaResults.length} |\n`);
      streamText(ctx.res, `| **Bugs Filed** | ${pCtx.bugs.length} |\n`);
      streamText(ctx.res, `| **Review** | ${pCtx.reviewResult?.approved ? "✅ APPROVED" : "❌ REJECTED"} (${pCtx.reviewResult?.score ?? "N/A"}/100) |\n`);

      endStream(ctx.res);
    } catch (err) {
      streamError(ctx.res, `Pipeline failed: ${(err as Error).message}`);
      endStream(ctx.res);
    }
  },
};

// ─── Helpers ───

function extractStoryId(message: string): number | null {
  const match = message.match(/\b(\d{2,})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function groupByFile(failures: TestFailure[]): Map<string, TestFailure[]> {
  const map = new Map<string, TestFailure[]>();
  for (const f of failures) {
    const arr = map.get(f.fileName) ?? [];
    arr.push(f);
    map.set(f.fileName, arr);
  }
  return map;
}

async function createBugFromRCA(
  result: RCAResult,
  pCtx: PipelineContext
): Promise<{ id: number; url: string } | null> {
  const failure = pCtx.failures.find((f) => f.testName === result.testName);
  const report: BugReport = {
    title: `[Auto-QA] ${result.category}: ${result.rootCause.slice(0, 100)}`,
    description: result.details,
    stepsToReproduce: `1. Run automated test: ${result.testName}\n2. Observe failure`,
    expectedResult: "Test should pass per acceptance criteria",
    actualResult: failure?.errorMessage ?? result.rootCause,
    errorLogs: result.errorLog.slice(0, 3000),
    screenshotPath: failure?.screenshotPath,
    testCaseRef: result.testName,
    rcaSummary: `Category: ${result.category}\nConfidence: ${result.confidence}\nRoot Cause: ${result.rootCause}`,
    rootCause: result.rootCause,
    severity: result.confidence > 0.8 ? "2 - High" : "3 - Medium",
    parentStoryId: pCtx.storyId,
  };

  return createBug(report);
}

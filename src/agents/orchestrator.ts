import { BaseAgent } from "./base.js";
import {
  AgentCard,
  AgentRequest,
  AgentResponse,
  LLMToolDefinition,
  parseToolCallName,
  makeMessage,
  AgentMessage,
} from "./protocol.js";
import {
  getAllToolDefinitions,
  invokeAgent,
  getSubAgents,
  getAgentManifest,
} from "./registry.js";
import { config } from "../config/index.js";
import { callLLMWithTools, ToolCallResult } from "../utils/llm.js";
import {
  PipelineContext,
  TestFailure,
  RCAResult,
  AutomationResult,
} from "./types.js";
import {
  writeTestFiles,
  runTests,
  readTestCode,
  updateTestFile,
} from "../orchestrator/testRunner.js";
import { createBug, BugReport } from "../ado/bugService.js";
import { RCAAgent } from "./rca.js";
import { analyzeFlakiness } from "../skills/flakinessDetector.js";

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the QA Orchestrator — the central intelligence that coordinates a team of specialized QA agents to achieve comprehensive test automation.

## Your Role
You receive a task (typically a user story ID) and you must decide which agents to invoke, in what order, and with what data. You are NOT a simple pipeline — you make intelligent decisions based on context, agent outputs, and failures.

## Available Agents
{AGENT_MANIFEST}

## Decision Framework
1. ALWAYS start by invoking @clarifier to check if the story needs clarification
2. If clarification is needed and has blocking questions, PAUSE and ask the user
3. Then invoke @requirement-analyst to extract requirements
4. Then @test-designer to create test cases
5. Then @automation-engineer to generate Playwright tests
6. After test execution, analyze results:
   - If tests pass → invoke @reviewer for governance
   - If tests fail → invoke @maintenance for fixes
   - If maintenance fails → invoke @rca for deep analysis
   - If RCA finds PRODUCT_BUG → create ADO bug
   - If RCA finds TEST_BUG → send back to @automation-engineer
7. After all fixes, invoke @reviewer for final approval
8. If @reviewer rejects → apply feedback and loop back

## Rules
- Invoke ONE agent at a time via tool calls
- Pass data between agents through the context/arguments
- Never skip the @clarifier step
- Never skip the @reviewer step
- Maximum 3 maintenance retries, maximum 3 reviewer loops
- When calling an agent, pass the required arguments from prior agent outputs
- Explain your reasoning before each tool call

## Output Format
For each step, respond with:
1. Your reasoning for what to do next
2. A tool call to the appropriate agent
3. After receiving the result, decide the next step

When the pipeline is COMPLETE, respond with: "PIPELINE_COMPLETE" followed by a summary.
When you need USER INPUT, respond with: "NEEDS_USER_INPUT" followed by the questions.
`;

/**
 * The Orchestrator Agent — the brain of the multi-agent system.
 *
 * Uses LLM function-calling to dynamically decide which sub-agent
 * to invoke based on context, prior results, and failures.
 * Follows the GitHub Copilot multi-agent orchestration pattern.
 */
export class OrchestratorAgent extends BaseAgent {
  private conversationHistory: AgentMessage[] = [];
  private pipelineCtx!: PipelineContext;

  constructor() {
    super("Orchestrator", "orchestrator");
  }

  getAgentCard(): AgentCard {
    return {
      slug: "orchestrator",
      name: "Orchestrator Agent",
      description: "Central intelligence that coordinates all QA agents — decides what to invoke, when, and with what data",
      instructions: "The brain of the system. Receives tasks and dynamically routes to sub-agents using LLM-driven tool-calling. Manages the full lifecycle from clarification through review.",
      skills: [
        {
          name: "run_pipeline",
          description: "Execute the full QA pipeline for an ADO user story, orchestrating all agents dynamically",
          parameters: [
            { name: "storyId", type: "number", description: "Azure DevOps user story ID", required: true },
            { name: "interactive", type: "boolean", description: "Whether to pause for user clarification", required: false },
            { name: "dryRun", type: "boolean", description: "Generate tests without executing", required: false },
            { name: "skipTests", type: "boolean", description: "Write tests but skip execution", required: false },
          ],
        },
      ],
      isOrchestrator: true,
    };
  }

  async handle(request: AgentRequest): Promise<AgentResponse> {
    return this.runOrchestration(request);
  }

  /**
   * Main orchestration loop — LLM decides what to do at each step.
   */
  async runOrchestration(request: AgentRequest): Promise<AgentResponse> {
    const storyId = request.arguments?.storyId as number ?? request.context.storyId!;
    const interactive = request.arguments?.interactive as boolean ?? request.context.interactive;
    const dryRun = request.arguments?.dryRun as boolean ?? false;
    const skipTests = request.arguments?.skipTests as boolean ?? false;

    this.log.info(`═══════════════════════════════════════════`);
    this.log.info(`  Orchestrator starting — Story #${storyId}`);
    this.log.info(`  Mode: ${dryRun ? "DRY RUN" : skipTests ? "SKIP TESTS" : "FULL"} | Interactive: ${interactive}`);
    this.log.info(`═══════════════════════════════════════════`);

    this.pipelineCtx = {
      storyId,
      storyTitle: "",
      failures: [],
      rcaResults: [],
      bugs: [],
      maintenanceAttempts: 0,
      reviewerLoops: 0,
    };

    const allMessages: AgentMessage[] = [];

    try {
      // ─── STEP 1: Clarification ───
      this.log.info("STEP 1: Checking if story needs clarification...");
      const clarifyResult = await this.invokeSubAgent("clarifier", "analyze_clarity", {
        story: await this.fetchStoryDirect(storyId),
      }, request.context);

      if (clarifyResult.needsUserInput && interactive) {
        this.log.info("Clarification needed — pausing for user input");
        return {
          agentSlug: "orchestrator",
          messages: [
            makeMessage("agent", "The story needs clarification before proceeding.", "orchestrator"),
            ...clarifyResult.messages,
          ],
          data: { clarification: clarifyResult.data, pipelineContext: this.pipelineCtx },
          needsUserInput: true,
          questions: clarifyResult.questions,
          status: "needs_input",
        };
      }
      allMessages.push(makeMessage("agent", `Clarification: ${clarifyResult.messages[0]?.content}`, "orchestrator"));

      // ─── STEP 2: Requirement Analysis ───
      this.log.info("STEP 2: Analyzing requirements...");
      const reqResult = await this.invokeSubAgent("requirement-analyst", "analyze_story", {
        storyId,
      }, request.context);
      this.pipelineCtx.requirements = reqResult.data as any;
      this.pipelineCtx.storyTitle = (reqResult.data as any)?.title ?? "";
      request.context.state.requirements = reqResult.data;
      allMessages.push(makeMessage("agent", `Requirements: ${reqResult.messages[0]?.content}`, "orchestrator"));

      // ─── STEP 3: Test Design ───
      this.log.info("STEP 3: Designing test cases...");
      const designResult = await this.invokeSubAgent("test-designer", "design_tests", {
        requirements: reqResult.data,
      }, request.context);
      this.pipelineCtx.testDesign = designResult.data as any;
      request.context.state.testDesign = designResult.data;
      allMessages.push(makeMessage("agent", `Test Design: ${designResult.messages[0]?.content}`, "orchestrator"));

      // ─── STEP 4: Automation ───
      this.log.info("STEP 4: Generating Playwright tests...");
      const autoResult = await this.invokeSubAgent("automation-engineer", "generate_tests", {
        testDesign: designResult.data,
      }, request.context);
      this.pipelineCtx.automation = autoResult.data as AutomationResult;
      request.context.state.automation = autoResult.data;
      allMessages.push(makeMessage("agent", `Automation: ${autoResult.messages[0]?.content}`, "orchestrator"));

      // Run flakiness pre-check
      const automationData = autoResult.data as AutomationResult;
      if (automationData?.tests) {
        for (const test of automationData.tests) {
          const report = analyzeFlakiness(test.code, test.fileName);
          if (report.riskScore > 0.25) {
            this.log.warn(`Flakiness risk: ${test.fileName} — ${report.recommendation}`);
          }
        }
      }

      // ─── STEP 5: Write & Execute Tests ───
      if (automationData?.tests) {
        writeTestFiles(automationData.tests, automationData.fixtureCode);
      }

      if (dryRun || skipTests) {
        this.log.info(`${dryRun ? "DRY RUN" : "SKIP TESTS"}: Skipping execution`);
        allMessages.push(makeMessage("agent", "Tests written to disk. Execution skipped.", "orchestrator"));
      } else {
        this.log.info("STEP 5: Executing Playwright tests...");
        this.pipelineCtx.failures = runTests();
        allMessages.push(makeMessage("agent",
          this.pipelineCtx.failures.length === 0
            ? "All tests passed!"
            : `${this.pipelineCtx.failures.length} test(s) failed`,
          "orchestrator"
        ));

        // ─── STEP 6: Maintenance Loop ───
        while (
          this.pipelineCtx.failures.length > 0 &&
          this.pipelineCtx.maintenanceAttempts < config.pipeline.maxMaintenanceRetries
        ) {
          this.pipelineCtx.maintenanceAttempts++;
          this.log.info(`STEP 6: Maintenance attempt ${this.pipelineCtx.maintenanceAttempts}...`);

          await this.runMaintenanceCycle(request.context);
          this.pipelineCtx.failures = runTests();

          if (this.pipelineCtx.failures.length === 0) {
            allMessages.push(makeMessage("agent",
              `All tests passed after maintenance attempt #${this.pipelineCtx.maintenanceAttempts}`,
              "orchestrator"
            ));
            break;
          }
        }

        // ─── STEP 7: RCA ───
        if (this.pipelineCtx.failures.length > 0) {
          this.log.info("STEP 7: Invoking RCA agent for deep analysis...");
          await this.runRCACycle(request.context);
          allMessages.push(makeMessage("agent",
            `RCA complete: ${this.pipelineCtx.rcaResults.length} result(s), ${this.pipelineCtx.bugs.length} bug(s) filed`,
            "orchestrator"
          ));
        }
      }

      // ─── STEP 8: Reviewer ───
      let approved = false;
      while (!approved && this.pipelineCtx.reviewerLoops < config.pipeline.maxReviewerLoops) {
        this.log.info(`STEP 8: Reviewer pass ${this.pipelineCtx.reviewerLoops + 1}...`);
        const reviewResult = await this.invokeSubAgent("reviewer", "review_pipeline", {
          pipelineContext: this.pipelineCtx,
        }, request.context);

        this.pipelineCtx.reviewResult = reviewResult.data as any;
        this.pipelineCtx.reviewerLoops++;

        if ((reviewResult.data as any)?.approved) {
          approved = true;
          allMessages.push(makeMessage("agent",
            `APPROVED by reviewer (score: ${(reviewResult.data as any).score}/100)`,
            "orchestrator"
          ));
        } else {
          allMessages.push(makeMessage("agent",
            `REJECTED by reviewer (score: ${(reviewResult.data as any)?.score}/100) — applying feedback`,
            "orchestrator"
          ));
          if (this.pipelineCtx.reviewerLoops < config.pipeline.maxReviewerLoops) {
            await this.applyReviewerFeedback(request.context);
          }
        }
      }

      // ─── DONE ───
      this.logPipelineSummary();

      return {
        agentSlug: "orchestrator",
        messages: allMessages,
        data: this.pipelineCtx,
        needsUserInput: false,
        status: "complete",
      };
    } catch (err) {
      this.log.error(`Orchestration failed: ${(err as Error).message}`);
      return this.error(`Orchestration failed: ${(err as Error).message}`);
    }
  }

  /**
   * Continue orchestration after user provides clarification answers.
   */
  async continueWithClarification(
    request: AgentRequest,
    answers: Record<string, string>
  ): Promise<AgentResponse> {
    this.log.info("Continuing orchestration with user clarification...");

    const clarification = request.context.state.clarification as any;
    if (clarification?.questions) {
      await this.invokeSubAgent("clarifier", "process_answers", {
        originalQuestions: clarification.questions,
        answers,
        story: request.context.state.story,
      }, request.context);
    }

    // Re-run the full orchestration with the enriched context
    return this.runOrchestration(request);
  }

  // ─── Private helpers ───

  private async invokeSubAgent(
    slug: string,
    skillName: string,
    args: Record<string, unknown>,
    context: AgentRequest["context"]
  ): Promise<AgentResponse> {
    this.log.info(`Orchestrator → @${slug}.${skillName}`);
    const response = await invokeAgent(slug, {
      messages: [],
      skillName,
      arguments: args,
      context,
    });

    if (response.status === "error") {
      this.log.error(`@${slug} returned error: ${response.messages[0]?.content}`);
    } else {
      this.log.info(`@${slug} complete: ${response.messages[0]?.content?.slice(0, 120)}`);
    }

    return response;
  }

  private async fetchStoryDirect(storyId: number) {
    const { fetchStory } = await import("../ado/storyService.js");
    return fetchStory(storyId);
  }

  private async runMaintenanceCycle(context: AgentRequest["context"]): Promise<void> {
    const byFile = new Map<string, TestFailure[]>();
    for (const f of this.pipelineCtx.failures) {
      const existing = byFile.get(f.fileName) ?? [];
      existing.push(f);
      byFile.set(f.fileName, existing);
    }

    for (const [fileName, failures] of byFile) {
      const testCode = readTestCode(fileName);
      if (!testCode) continue;

      const maintResult = await this.invokeSubAgent("maintenance", "diagnose_and_fix", {
        failures,
        testCode,
      }, context);

      const fixes = maintResult.data as any[];
      if (fixes) {
        for (const fix of fixes) {
          updateTestFile(fix.fileName, fix.fixedCode);
        }
      }
    }
  }

  private async runRCACycle(context: AgentRequest["context"]): Promise<void> {
    const allCode = this.pipelineCtx.failures
      .map((f) => `// ${f.fileName}\n${readTestCode(f.fileName)}`)
      .join("\n\n");

    const rcaResult = await this.invokeSubAgent("rca", "analyze_failures", {
      failures: this.pipelineCtx.failures,
      testCode: allCode,
      maintenanceAttempts: this.pipelineCtx.maintenanceAttempts,
    }, context);

    const results = rcaResult.data as RCAResult[];
    this.pipelineCtx.rcaResults = results ?? [];

    for (const result of this.pipelineCtx.rcaResults) {
      const action = RCAAgent.decideAction(result);
      this.log.info(`RCA → ${result.testName}: ${action} (${result.category})`);

      if (action === "create_bug") {
        await this.createBugFromRCA(result);
      } else if (action === "fix_test") {
        const test = this.pipelineCtx.automation?.tests.find(
          (t) => t.fileName === result.testName || result.testName.includes(t.testCaseId)
        );
        if (test) {
          const fixResult = await this.invokeSubAgent("automation-engineer", "apply_fix", {
            test,
            fixDescription: result.suggestedFix,
            errorLog: result.errorLog,
          }, context);
          const fixed = fixResult.data as any;
          if (fixed) {
            updateTestFile(fixed.fileName, fixed.code);
            for (const po of fixed.pageObjects ?? []) {
              updateTestFile(po.fileName, po.code);
            }
          }
        }
      }
    }
  }

  private async createBugFromRCA(result: RCAResult): Promise<void> {
    const failure = this.pipelineCtx.failures.find(
      (f) => f.testName === result.testName
    );
    const bugReport: BugReport = {
      title: `[Auto-QA] ${result.category}: ${result.rootCause.slice(0, 100)}`,
      description: result.details,
      stepsToReproduce: `1. Run automated test: ${result.testName}\n2. Observe failure`,
      expectedResult: "Test should pass per story acceptance criteria",
      actualResult: failure?.errorMessage ?? result.rootCause,
      errorLogs: result.errorLog.slice(0, 3000),
      screenshotPath: failure?.screenshotPath,
      testCaseRef: result.testName,
      rcaSummary: `Category: ${result.category}\nConfidence: ${result.confidence}\nRoot Cause: ${result.rootCause}\nSuggested Fix: ${result.suggestedFix}`,
      rootCause: result.rootCause,
      severity: result.confidence > 0.8 ? "2 - High" : result.confidence > 0.5 ? "3 - Medium" : "4 - Low",
      parentStoryId: this.pipelineCtx.storyId,
    };

    const created = await createBug(bugReport);
    if (created) {
      this.pipelineCtx.bugs.push(created);
    }
  }

  private async applyReviewerFeedback(context: AgentRequest["context"]): Promise<void> {
    const review = this.pipelineCtx.reviewResult;
    if (!review || !this.pipelineCtx.automation) return;

    const blockers = review.issues.filter(
      (i) => i.severity === "blocker" || i.severity === "major"
    );
    for (const issue of blockers) {
      const test = this.pipelineCtx.automation.tests.find(
        (t) => issue.location?.includes(t.fileName) || issue.location?.includes(t.testCaseId)
      );
      if (test) {
        const fixResult = await this.invokeSubAgent("automation-engineer", "apply_fix", {
          test,
          fixDescription: `Reviewer: ${issue.description}\nSuggestion: ${issue.suggestion}`,
          errorLog: "",
        }, context);
        const fixed = fixResult.data as any;
        if (fixed) {
          updateTestFile(fixed.fileName, fixed.code);
        }
      }
    }
  }

  private logPipelineSummary(): void {
    this.log.info(`\n═══════════════════════════════════════════`);
    this.log.info(`  ORCHESTRATION COMPLETE — Story #${this.pipelineCtx.storyId}`);
    this.log.info(`═══════════════════════════════════════════`);
    this.log.info(`  Story:       ${this.pipelineCtx.storyTitle}`);
    this.log.info(`  Scenarios:   ${this.pipelineCtx.requirements?.scenarios.length ?? 0}`);
    this.log.info(`  Test Cases:  ${this.pipelineCtx.testDesign?.testCases.length ?? 0}`);
    this.log.info(`  Test Files:  ${this.pipelineCtx.automation?.tests.length ?? 0}`);
    this.log.info(`  Failures:    ${this.pipelineCtx.failures.length}`);
    this.log.info(`  Maintenance: ${this.pipelineCtx.maintenanceAttempts} attempt(s)`);
    this.log.info(`  RCA:         ${this.pipelineCtx.rcaResults.length} result(s)`);
    this.log.info(`  Bugs Filed:  ${this.pipelineCtx.bugs.length}`);
    this.log.info(`  Review:      ${this.pipelineCtx.reviewResult?.approved ? "APPROVED" : "REJECTED"} (${this.pipelineCtx.reviewResult?.score ?? "N/A"}/100)`);
    this.log.info(`═══════════════════════════════════════════\n`);
  }
}

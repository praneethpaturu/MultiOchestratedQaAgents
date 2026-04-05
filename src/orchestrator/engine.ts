/**
 * Orchestrator Engine
 *
 * Loads .md agent definitions, initializes MCP tools,
 * and executes the multi-agent QA pipeline by:
 *   1. Feeding each agent its system prompt (from .md)
 *   2. Passing context from prior agents
 *   3. Routing tool calls through MCP
 *   4. Managing state, loops, and decisions
 */

import { agentLogger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { routeToModel } from "../utils/router.js";
import { extractJSON } from "../utils/helpers.js";
import { loadAllAgents, AgentDefinition } from "./agentLoader.js";
import {
  createPipelineState,
  startStep,
  completeStep,
  failStep,
  finishPipeline,
  getPipelineSummary,
  PipelineState,
} from "./stateManager.js";
import { initMCPServer, executeTool, listTools } from "../mcp/server.js";

const log = agentLogger("Orchestrator");

export interface EngineOptions {
  storyId: number;
  dryRun?: boolean;
  skipTests?: boolean;
}

// ─── Map agent slugs to model config keys ───
const AGENT_ROLE_MAP: Record<string, string> = {
  "requirement-agent": "requirement",
  "test-designer-agent": "testDesign",
  "automation-agent": "automation",
  "maintenance-agent": "maintenance",
  "rca-agent": "rca",
  "reviewer-agent": "reviewer",
};

/**
 * Run the full multi-agent orchestrated pipeline.
 */
export async function runEngine(options: EngineOptions): Promise<PipelineState> {
  const { storyId, dryRun, skipTests } = options;

  // Initialize
  initMCPServer();
  const agents = loadAllAgents();
  const state = createPipelineState(storyId);

  const agentMap = new Map<string, AgentDefinition>();
  for (const a of agents) agentMap.set(a.slug, a);

  log.info(`══════════════════════════════════════════`);
  log.info(`  Orchestrator — Story #${storyId}`);
  log.info(`  Agents: ${agents.map((a) => a.slug).join(", ")}`);
  log.info(`  MCP Tools: ${listTools().length}`);
  log.info(`══════════════════════════════════════════`);

  try {
    // ── STEP 1: Requirement Analysis ──
    const reqAgent = agentMap.get("requirement-agent")!;
    const reqStep = startStep(state, reqAgent.slug, "Analyze requirements");

    const reqResult = await invokeAgent(reqAgent, {
      storyId,
    });
    state.requirements = reqResult;
    state.storyTitle = (reqResult as any)?.title ?? "";
    completeStep(state, reqStep, reqResult);

    // ── STEP 2: Test Design ──
    const designAgent = agentMap.get("test-designer-agent")!;
    const designStep = startStep(state, designAgent.slug, "Design test cases");

    const designResult = await invokeAgent(designAgent, {
      requirements: state.requirements,
      storyId,
    });
    state.testDesign = designResult;
    completeStep(state, designStep, designResult);

    // ── STEP 3: Automation ──
    const autoAgent = agentMap.get("automation-agent")!;
    const autoStep = startStep(state, autoAgent.slug, "Generate Playwright tests");

    const autoResult = await invokeAgent(autoAgent, {
      testDesign: state.testDesign,
      storyId,
    });
    state.automation = autoResult;
    completeStep(state, autoStep, autoResult);

    if (dryRun || skipTests) {
      log.info(`${dryRun ? "DRY RUN" : "SKIP TESTS"}: Execution skipped`);
      finishPipeline(state);
      return state;
    }

    // ── STEP 4: Run Tests ──
    const runStep = startStep(state, "playwright", "Execute tests");
    const runResult = await executeTool("runTests", {});
    state.testResults = runResult.result as any;
    completeStep(state, runStep, runResult.result);

    // ── STEP 5: Maintenance Loop ──
    const failures = (state.testResults as any)?.failures ?? [];
    let currentFailures = failures;

    while (
      currentFailures.length > 0 &&
      state.maintenanceAttempts < config.pipeline.maxMaintenanceRetries
    ) {
      state.maintenanceAttempts++;
      const maintAgent = agentMap.get("maintenance-agent")!;
      const maintStep = startStep(state, maintAgent.slug, `Maintenance attempt ${state.maintenanceAttempts}`);

      const maintResult = await invokeAgent(maintAgent, {
        failures: currentFailures,
        testCode: "// loaded from generated files",
      });
      state.maintenanceFixes = (maintResult as any)?.fixes ?? [];
      completeStep(state, maintStep, maintResult);

      // Re-run tests
      const rerunResult = await executeTool("runTests", {});
      currentFailures = (rerunResult.result as any)?.failures ?? [];
      state.testResults = rerunResult.result as any;

      if (currentFailures.length === 0) {
        log.info(`Tests passed after maintenance attempt #${state.maintenanceAttempts}`);
        break;
      }
    }

    // ── STEP 6: RCA (if still failing) ──
    if (currentFailures.length > 0) {
      const rcaAgent = agentMap.get("rca-agent")!;
      const rcaStep = startStep(state, rcaAgent.slug, "Root cause analysis");

      // Gather actual test code for RCA context
      const testCodeSnippets = (currentFailures as any[])
        .map((f: any) => {
          try {
            const fs = require("fs");
            const path = require("path");
            const p = path.resolve(process.cwd(), "playwright/tests/generated", f.fileName ?? "");
            return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
          } catch { return ""; }
        })
        .filter(Boolean)
        .join("\n\n");

      const rcaResult = await invokeAgent(rcaAgent, {
        failures: currentFailures,
        testCode: testCodeSnippets || "(test code not available)",
        maintenanceAttempts: state.maintenanceAttempts,
      });
      state.rcaResults = (rcaResult as any)?.results ?? [];
      completeStep(state, rcaStep, rcaResult);

      // Handle RCA actions
      for (const result of state.rcaResults as any[]) {
        if (result.action === "create_bug" || result.isProductBug) {
          const bugResult = await executeTool("createBug", {
            title: `[Auto-QA] ${result.category}: ${(result.rootCause ?? "").slice(0, 100)}`,
            description: result.details ?? result.rootCause,
            reproSteps: `1. Run test: ${result.testName}\n2. Observe failure`,
            severity: result.confidence > 0.8 ? "2 - High" : "3 - Medium",
            parentStoryId: storyId,
            tags: "auto-qa-agent;rca-generated",
          });
          if (bugResult.success) {
            state.bugs.push(bugResult.result as any);
            log.info(`Bug created: #${(bugResult.result as any).id}`);
          }
        }
      }
    }

    // ── STEP 7: Reviewer Loop ──
    let approved = false;
    while (!approved && state.reviewerLoops < config.pipeline.maxReviewerLoops) {
      const reviewAgent = agentMap.get("reviewer-agent")!;
      const reviewStep = startStep(state, reviewAgent.slug, `Review pass ${state.reviewerLoops + 1}`);

      const reviewResult = await invokeAgent(reviewAgent, {
        pipelineContext: getPipelineSummary(state),
        requirements: state.requirements,
        testDesign: state.testDesign,
        automation: state.automation,
        failures: currentFailures,
        rcaResults: state.rcaResults ?? [],
        bugs: state.bugs,
      });
      state.reviewResult = reviewResult as any;
      state.reviewerLoops++;
      completeStep(state, reviewStep, reviewResult);

      approved = (reviewResult as any)?.approved ?? false;
      if (approved) {
        log.info(`APPROVED (score: ${(reviewResult as any)?.score}/100)`);
      } else {
        log.warn(`REJECTED (score: ${(reviewResult as any)?.score}/100)`);
      }
    }

    finishPipeline(state);
    logSummary(state);
    return state;
  } catch (err) {
    log.error(`Engine failed: ${(err as Error).message}`);
    finishPipeline(state);
    throw err;
  }
}

// ─── Invoke Agent via LLM ───

async function invokeAgent(
  agent: AgentDefinition,
  context: Record<string, unknown>
): Promise<unknown> {
  log.info(`Invoking agent: ${agent.name}`);

  // Build system prompt from the .md definition
  const systemPrompt = `${agent.rawMarkdown}

IMPORTANT: You have access to MCP tools. When you need to use a tool, include a tool_call in your response. Respond with a JSON object containing your analysis/output as described in your Outputs section.`;

  const userPrompt = `Execute your task with the following context:\n\n${JSON.stringify(context, null, 2)}\n\nRespond with the JSON output only.`;

  const role = AGENT_ROLE_MAP[agent.slug] ?? "requirement";

  // Execute MCP tools the agent references
  for (const toolName of agent.mcpTools) {
    const toolArgs = buildToolArgs(toolName, context);
    if (toolArgs) {
      const result = await executeTool(toolName, toolArgs);
      if (result.success) {
        (context as any)[`tool_${toolName}`] = result.result;
      }
    }
  }

  const response = await routeToModel({
    role: role as any,
    systemPrompt,
    userPrompt: `Context (including tool results):\n${JSON.stringify(context, null, 2)}\n\nProduce your output as JSON.`,
    maxTokens: 6000,
  });

  try {
    return extractJSON(response.content);
  } catch {
    return { rawResponse: response.content };
  }
}

/**
 * Build arguments for a tool call based on available context.
 */
function buildToolArgs(
  toolName: string,
  context: Record<string, unknown>
): Record<string, unknown> | null {
  switch (toolName) {
    case "getUserStory":
      return context.storyId ? { storyId: context.storyId } : null;
    case "logEvent":
      return { agent: "orchestrator", event: "step_executed", data: {} };
    case "saveMemory":
      return null; // Agent decides what to save
    case "retrieveMemory":
      return context.storyId
        ? { key: `requirements:${context.storyId}`, type: "requirement_analysis" }
        : null;
    case "getFailures":
      return {};
    case "runTests":
      return {};
    case "findSimilarFailures":
      return context.failures
        ? { errorSignature: JSON.stringify(context.failures).slice(0, 200), limit: 5 }
        : null;
    case "analyzeLogs":
      return context.failures ? { failures: context.failures, testCode: context.testCode ?? "" } : null;
    case "calculateConfidence":
      return null; // RCA agent computes this per-result
    default:
      return null;
  }
}

function logSummary(state: PipelineState): void {
  const summary = getPipelineSummary(state);
  log.info(`\n══════════════════════════════════════════`);
  log.info(`  PIPELINE COMPLETE — Story #${state.storyId}`);
  log.info(`══════════════════════════════════════════`);
  for (const [key, value] of Object.entries(summary)) {
    log.info(`  ${key}: ${value}`);
  }
  log.info(`══════════════════════════════════════════\n`);
}

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

import fs from "fs";
import path from "path";
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

  cleanWorkspace();

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

    const generatedTests = (autoResult as any)?.tests;
    if (Array.isArray(generatedTests) && generatedTests.length > 0) {
      const { writeTestFiles } = await import("./testRunner.js");
      writeTestFiles(generatedTests);
      log.info(`Persisted ${generatedTests.length} test file(s) to disk`);
    }

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
    await persistFailures(storyId, (runResult.result as any)?.failures ?? []);

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

      const filesInPlay = collectGeneratedFilesForFailures(currentFailures);

      const maintResult = await invokeAgent(maintAgent, {
        failures: currentFailures,
        testCode: filesInPlay.combined,
        fileMap: filesInPlay.byFile,
      });
      state.maintenanceFixes = (maintResult as any)?.fixes ?? [];
      completeStep(state, maintStep, maintResult);

      applyMaintenanceFixes(state.maintenanceFixes as any[]);

      // Re-run tests
      const rerunResult = await executeTool("runTests", {});
      currentFailures = (rerunResult.result as any)?.failures ?? [];
      state.testResults = rerunResult.result as any;
      await persistFailures(storyId, currentFailures);

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
            const filePath = path.resolve(process.cwd(), "playwright/tests/generated", f.fileName ?? "");
            return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
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
      await persistRcaResults(storyId, state.rcaResults as any[]);

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
            const bug = bugResult.result as any;
            state.bugs.push(bug);
            log.info(`Bug created: #${bug.id}`);
            await executeTool("saveMemory", {
              key: `bug:${bug.id}`,
              type: "bug_filed",
              data: {
                bugId: bug.id,
                storyId,
                category: result.category,
                rootCause: result.rootCause,
                title: `[Auto-QA] ${result.category}: ${(result.rootCause ?? "").slice(0, 100)}`,
                confidence: result.confidence,
                testName: result.testName,
              },
            });
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

  await executeTool("logEvent", {
    agent: agent.slug,
    event: "started",
    data: { storyId: context.storyId, contextKeys: Object.keys(context) },
  });

  // Build system prompt from the .md definition
  const systemPrompt = `${agent.rawMarkdown}

IMPORTANT: You have access to MCP tools. When you need to use a tool, include a tool_call in your response. Respond with a JSON object containing your analysis/output as described in your Outputs section.`;

  const userPrompt = `Execute your task with the following context:\n\n${JSON.stringify(context, null, 2)}\n\nRespond with the JSON output only.`;

  const role = AGENT_ROLE_MAP[agent.slug] ?? "requirement";

  // Execute MCP tools the agent references
  for (const toolName of agent.mcpTools) {
    const toolArgs = buildToolArgs(toolName, context, agent.slug);
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

  let parsed: unknown;
  try {
    parsed = extractJSON(response.content);
  } catch {
    parsed = { rawResponse: response.content };
  }

  await persistAgentResult(agent.slug, context.storyId, parsed);

  await executeTool("logEvent", {
    agent: agent.slug,
    event: "completed",
    data: { storyId: context.storyId, outputKeys: Object.keys((parsed as Record<string, unknown>) ?? {}) },
  });

  return parsed;
}

function collectGeneratedFilesForFailures(failures: any[]): { combined: string; byFile: Record<string, string> } {
  const genDir = path.resolve(process.cwd(), "playwright/tests/generated");
  const pagesDir = path.resolve(process.cwd(), "playwright/pages");
  const byFile: Record<string, string> = {};

  // Always include all current test specs + page objects so the agent has context
  for (const dir of [genDir, pagesDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts") && !f.endsWith(".js")) continue;
      if (f === ".gitkeep") continue;
      try {
        byFile[f] = fs.readFileSync(path.join(dir, f), "utf-8");
      } catch {}
    }
  }
  const combined = Object.entries(byFile)
    .map(([name, code]) => `// ── ${name} ──\n${code}`)
    .join("\n\n");
  return { combined, byFile };
}

function applyMaintenanceFixes(fixes: any[]): void {
  if (!Array.isArray(fixes) || fixes.length === 0) return;
  const genDir = path.resolve(process.cwd(), "playwright/tests/generated");
  const pagesDir = path.resolve(process.cwd(), "playwright/pages");

  for (const fix of fixes) {
    const fileName: string | undefined = fix?.fileName;
    const fixedCode: string | undefined = fix?.fixedCode ?? fix?.code;
    if (!fileName || !fixedCode) continue;

    // Sanity: a complete file must contain at least one import statement.
    // The maintenance agent occasionally returns only the changed snippet,
    // which would clobber the whole file with one line.
    const looksLikeCompleteFile =
      /\bimport\s+/.test(fixedCode) ||
      /\b(export\s+(class|default|function)|module\.exports)\b/.test(fixedCode);
    if (!looksLikeCompleteFile) {
      log.warn(`Skipping maintenance fix for ${fileName}: returned content looks like a snippet, not a complete file (${fixedCode.length} chars)`);
      continue;
    }

    // Decide target dir: if filename looks like a page object, write under pages/
    const isPageObject = /Page\.(ts|js)$/.test(fileName) || /\bpages\//.test(fileName);
    const target = isPageObject
      ? path.join(pagesDir, path.basename(fileName))
      : path.join(genDir, path.basename(fileName));

    try {
      fs.writeFileSync(target, fixedCode);
      log.info(`Maintenance fix applied: ${path.basename(target)} (${fixedCode.length} chars)`);
    } catch (err) {
      log.warn(`Failed to write maintenance fix for ${fileName}: ${(err as Error).message}`);
    }
  }
}

function cleanWorkspace(): void {
  const genDir = path.resolve(process.cwd(), "playwright/tests/generated");
  const pagesDir = path.resolve(process.cwd(), "playwright/pages");
  const reportsDir = path.resolve(process.cwd(), "reports");

  if (fs.existsSync(genDir)) {
    for (const f of fs.readdirSync(genDir)) {
      if (f === ".gitkeep") continue;
      try { fs.unlinkSync(path.join(genDir, f)); } catch {}
    }
  }
  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir)) {
      if (f === "BasePage.ts") continue;
      try { fs.unlinkSync(path.join(pagesDir, f)); } catch {}
    }
  }
  if (fs.existsSync(reportsDir)) {
    try { fs.rmSync(reportsDir, { recursive: true, force: true }); } catch {}
  }

  log.info(`Cleaned workspace: tests/generated, pages, reports`);
}

async function persistFailures(storyId: number, failures: any[]): Promise<void> {
  for (const f of failures || []) {
    await executeTool("saveMemory", {
      key: `failure:${storyId}:${(f.testName ?? "unknown").slice(0, 80)}:${Date.now()}`,
      type: "failure",
      data: {
        storyId,
        testName: f.testName,
        fileName: f.fileName,
        error: (f.errorMessage ?? "").slice(0, 500),
        duration: f.duration,
        screenshotPath: f.screenshotPath,
      },
    });
  }
}

async function persistRcaResults(storyId: number, results: any[]): Promise<void> {
  for (const r of results || []) {
    await executeTool("saveMemory", {
      key: `rca:${storyId}:${(r.testName ?? "unknown").slice(0, 80)}:${Date.now()}`,
      type: "rca_result",
      data: { storyId, ...r },
    });
  }
}

async function persistAgentResult(
  agentSlug: string,
  storyId: unknown,
  result: unknown
): Promise<void> {
  if (!result || typeof result !== "object") return;
  const typeMap: Record<string, string> = {
    "requirement-agent": "requirement_analysis",
    "test-designer-agent": "test_design",
    "automation-agent": "generated_tests",
    "rca-agent": "rca_result",
    "reviewer-agent": "review",
    "maintenance-agent": "maintenance_fix",
    "clarifier-agent": "clarification",
  };
  const memType = typeMap[agentSlug];
  if (!memType) return;
  const key = `${memType}:${storyId ?? "unknown"}`;
  await executeTool("saveMemory", { key, type: memType, data: result });
}

/**
 * Build arguments for a tool call based on available context.
 */
function buildToolArgs(
  toolName: string,
  context: Record<string, unknown>,
  agentSlug: string = "orchestrator"
): Record<string, unknown> | null {
  switch (toolName) {
    case "getUserStory":
      return context.storyId ? { storyId: context.storyId } : null;
    case "logEvent":
      return { agent: agentSlug, event: "tool_invoked", data: { storyId: context.storyId } };
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
    case "browserSnapshot": {
      const baseUrl = process.env.BASE_URL;
      if (!baseUrl || baseUrl === "https://example.com") return null;
      return { url: baseUrl, maxElements: 60 };
    }
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

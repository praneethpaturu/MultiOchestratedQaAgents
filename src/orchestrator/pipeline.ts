import { v4 as uuid } from "uuid";
import { agentLogger } from "../utils/logger.js";
import { AgentContext, AgentResponse } from "../agents/protocol.js";
import { PipelineContext } from "../agents/types.js";
import { initializeAgents } from "./agentInit.js";
import { OrchestratorAgent } from "../agents/orchestrator.js";
import { getAgentManifest } from "../agents/registry.js";

const log = agentLogger("Pipeline");

export interface PipelineOptions {
  storyId: number;
  skipTests?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
}

/**
 * Run the full QA pipeline through the Orchestrator agent.
 *
 * The orchestrator dynamically decides which sub-agents to invoke,
 * when, and with what data — replacing the old hardcoded pipeline.
 */
export async function runPipeline(options: PipelineOptions): Promise<PipelineContext> {
  const { storyId, skipTests, dryRun, interactive } = options;

  // Initialize all agents (self-register in registry)
  initializeAgents();

  log.info("Registered agents:");
  log.info(getAgentManifest());

  // Build the agent context
  const context: AgentContext = {
    storyId,
    conversationId: uuid(),
    state: {},
    interactive: interactive ?? false,
  };

  // Get the orchestrator and kick off
  const orchestrator = new OrchestratorAgent();

  const response: AgentResponse = await orchestrator.handle({
    messages: [],
    skillName: "run_pipeline",
    arguments: {
      storyId,
      interactive: interactive ?? false,
      dryRun: dryRun ?? false,
      skipTests: skipTests ?? false,
    },
    context,
  });

  // Log orchestrator output
  for (const msg of response.messages) {
    log.info(`[${msg.agentSlug ?? "system"}] ${msg.content}`);
  }

  return (response.data as PipelineContext) ?? {
    storyId,
    storyTitle: "",
    failures: [],
    rcaResults: [],
    bugs: [],
    maintenanceAttempts: 0,
    reviewerLoops: 0,
  };
}

/**
 * Continue a paused pipeline (after user provides clarification answers).
 */
export async function continuePipeline(
  options: PipelineOptions,
  answers: Record<string, string>,
  priorContext: AgentContext
): Promise<PipelineContext> {
  initializeAgents();

  const orchestrator = new OrchestratorAgent();
  const response = await orchestrator.continueWithClarification(
    {
      messages: [],
      skillName: "run_pipeline",
      arguments: {
        storyId: options.storyId,
        interactive: options.interactive ?? false,
        dryRun: options.dryRun ?? false,
        skipTests: options.skipTests ?? false,
      },
      context: priorContext,
    },
    answers
  );

  return (response.data as PipelineContext) ?? {
    storyId: options.storyId,
    storyTitle: "",
    failures: [],
    rcaResults: [],
    bugs: [],
    maintenanceAttempts: 0,
    reviewerLoops: 0,
  };
}

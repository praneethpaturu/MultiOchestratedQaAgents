/**
 * Pipeline State Manager
 *
 * Maintains the shared state passed between agents during
 * a pipeline execution. Each step writes its output here,
 * and subsequent steps read from it.
 */

import { agentLogger } from "../utils/logger.js";

const log = agentLogger("StateManager");

export interface PipelineState {
  storyId: number;
  storyTitle: string;
  currentStep: string;
  steps: StepRecord[];

  // Agent outputs
  story?: unknown;
  requirements?: unknown;
  testDesign?: unknown;
  automation?: unknown;
  testResults?: { passed: boolean; failures: unknown[] };
  maintenanceFixes?: unknown[];
  rcaResults?: unknown[];
  reviewResult?: { approved: boolean; score: number; issues: unknown[] };
  bugs: { id: number; url: string }[];

  // Counters
  maintenanceAttempts: number;
  reviewerLoops: number;

  // Timing
  startTime: string;
  endTime?: string;
}

export interface StepRecord {
  agent: string;
  step: string;
  status: "running" | "complete" | "failed" | "skipped";
  startTime: string;
  endTime?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
}

export function createPipelineState(storyId: number): PipelineState {
  return {
    storyId,
    storyTitle: "",
    currentStep: "init",
    steps: [],
    bugs: [],
    maintenanceAttempts: 0,
    reviewerLoops: 0,
    startTime: new Date().toISOString(),
  };
}

export function startStep(state: PipelineState, agent: string, step: string): StepRecord {
  const record: StepRecord = {
    agent,
    step,
    status: "running",
    startTime: new Date().toISOString(),
  };
  state.currentStep = step;
  state.steps.push(record);
  log.info(`Step started: [${agent}] ${step}`);
  return record;
}

export function completeStep(
  state: PipelineState,
  record: StepRecord,
  output?: unknown
): void {
  record.status = "complete";
  record.endTime = new Date().toISOString();
  record.durationMs = new Date(record.endTime).getTime() - new Date(record.startTime).getTime();
  record.output = output;
  log.info(`Step complete: [${record.agent}] ${record.step} (${record.durationMs}ms)`);
}

export function failStep(
  state: PipelineState,
  record: StepRecord,
  error: string
): void {
  record.status = "failed";
  record.endTime = new Date().toISOString();
  record.durationMs = new Date(record.endTime).getTime() - new Date(record.startTime).getTime();
  record.error = error;
  log.error(`Step failed: [${record.agent}] ${record.step}: ${error}`);
}

export function finishPipeline(state: PipelineState): void {
  state.endTime = new Date().toISOString();
  const totalMs = new Date(state.endTime).getTime() - new Date(state.startTime).getTime();
  log.info(`Pipeline finished in ${(totalMs / 1000).toFixed(1)}s`);
}

export function getPipelineSummary(state: PipelineState): Record<string, unknown> {
  return {
    storyId: state.storyId,
    storyTitle: state.storyTitle,
    totalSteps: state.steps.length,
    completedSteps: state.steps.filter((s) => s.status === "complete").length,
    failedSteps: state.steps.filter((s) => s.status === "failed").length,
    maintenanceAttempts: state.maintenanceAttempts,
    reviewerLoops: state.reviewerLoops,
    bugsCreated: state.bugs.length,
    approved: state.reviewResult?.approved ?? null,
    score: state.reviewResult?.score ?? null,
    duration: state.endTime
      ? `${((new Date(state.endTime).getTime() - new Date(state.startTime).getTime()) / 1000).toFixed(1)}s`
      : "in progress",
  };
}

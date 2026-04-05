// ─── Shared Types for Agent Pipeline ───

export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: string[];
  expectedResult: string;
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
  type: "positive" | "negative" | "edge_case" | "boundary";
}

export interface RequirementAnalysis {
  storyId: number;
  title: string;
  acceptanceCriteria: string[];
  scenarios: Scenario[];
  edgeCases: string[];
  assumptions: string[];
  outOfScope: string[];
}

export interface TestCase {
  id: string;
  scenarioId: string;
  title: string;
  description: string;
  preconditions: string[];
  steps: { action: string; expected: string }[];
  priority: "P0" | "P1" | "P2" | "P3";
  tags: string[];
  automatable: boolean;
  riskLevel: "high" | "medium" | "low";
}

export interface TestDesign {
  storyId: number;
  testCases: TestCase[];
  coverageNotes: string;
}

export interface GeneratedTest {
  fileName: string;
  code: string;
  testCaseId: string;
  pageObjects: { fileName: string; code: string }[];
}

export interface AutomationResult {
  storyId: number;
  tests: GeneratedTest[];
  fixtureCode?: string;
}

export type RCACategory =
  | "UI_CHANGE"
  | "LOCATOR_BROKEN"
  | "API_FAILURE"
  | "DATA_ISSUE"
  | "ENVIRONMENT_ISSUE"
  | "TEST_BUG"
  | "PRODUCT_BUG";

export interface RCAResult {
  testName: string;
  rootCause: string;
  category: RCACategory;
  confidence: number;
  suggestedFix: string;
  isAutomationIssue: boolean;
  isProductBug: boolean;
  details: string;
  errorLog: string;
}

export interface ReviewResult {
  approved: boolean;
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

export interface ReviewIssue {
  category: string;
  severity: "blocker" | "major" | "minor";
  description: string;
  suggestion: string;
  location?: string;
}

export interface TestFailure {
  testName: string;
  fileName: string;
  errorMessage: string;
  errorStack: string;
  screenshotPath?: string;
  duration: number;
}

export interface MaintenanceFix {
  testName: string;
  fileName: string;
  originalCode: string;
  fixedCode: string;
  fixDescription: string;
}

export interface PipelineContext {
  storyId: number;
  storyTitle: string;
  requirements?: RequirementAnalysis;
  testDesign?: TestDesign;
  automation?: AutomationResult;
  failures: TestFailure[];
  rcaResults: RCAResult[];
  reviewResult?: ReviewResult;
  bugs: { id: number; url: string }[];
  maintenanceAttempts: number;
  reviewerLoops: number;
}

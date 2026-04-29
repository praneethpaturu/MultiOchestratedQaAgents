import { addMemory, queryMemory } from "../memory/store.js";
import { agentLogger } from "../utils/logger.js";
import { TestFailure } from "../agents/types.js";
import { rankSelectorStability } from "./locatorHealing.js";

const log = agentLogger("FlakinessDetector");

export interface FlakinessReport {
  testName: string;
  riskScore: number; // 0-1, higher is more risky
  reasons: string[];
  recommendation: "stable" | "needs_attention" | "high_risk" | "quarantine";
}

/**
 * Analyze test code for flakiness risk indicators.
 */
export function analyzeFlakiness(testCode: string, testName: string): FlakinessReport {
  const reasons: string[] = [];
  let riskScore = 0;

  // Check for hardcoded waits
  const hardWaits = testCode.match(/page\.waitForTimeout\(\d+\)/g);
  if (hardWaits) {
    riskScore += 0.3;
    reasons.push(`${hardWaits.length} hardcoded wait(s) found`);
  }

  // Check for fragile selectors
  const selectors = testCode.match(/(locator|querySelector)\(['"]([^'"]+)['"]\)/g) ?? [];
  for (const sel of selectors) {
    const selectorStr = sel.match(/\(['"]([^'"]+)['"]\)/)?.[1] ?? "";
    const stability = rankSelectorStability(selectorStr);
    if (stability < 0.5) {
      riskScore += 0.15;
      reasons.push(`Fragile selector: ${selectorStr} (stability: ${stability})`);
    }
  }

  // Check for missing waits before assertions
  if (testCode.match(/\.click\(\)[\s\S]{0,30}expect\(/)) {
    riskScore += 0.2;
    reasons.push("Assertion immediately after click without wait");
  }

  // Check for fixed test data (dates, IDs)
  if (testCode.match(/20\d{2}-\d{2}-\d{2}/)) {
    riskScore += 0.1;
    reasons.push("Hardcoded date found — may become stale");
  }

  // Check for network-dependent assertions without waitForResponse
  if (
    testCode.includes("toContainText") &&
    !testCode.includes("waitForResponse") &&
    !testCode.includes("waitForLoadState")
  ) {
    riskScore += 0.15;
    reasons.push("Text assertion without network wait");
  }

  // Check for race conditions with multiple parallel actions
  if (testCode.match(/Promise\.all/)) {
    riskScore += 0.1;
    reasons.push("Parallel actions may cause race conditions");
  }

  riskScore = Math.min(riskScore, 1.0);

  const recommendation: FlakinessReport["recommendation"] =
    riskScore >= 0.7
      ? "quarantine"
      : riskScore >= 0.5
        ? "high_risk"
        : riskScore >= 0.25
          ? "needs_attention"
          : "stable";

  if (riskScore > 0.25) {
    log.warn(
      `${testName}: flakiness risk ${(riskScore * 100).toFixed(0)}% (${recommendation})`
    );
  }

  return { testName, riskScore, reasons, recommendation };
}

/**
 * Track test execution history for flakiness detection.
 * Call after each test run.
 */
export function recordTestExecution(
  testName: string,
  passed: boolean,
  duration: number
): void {
  const history = queryMemory({ type: "failure", testName, limit: 10 });
  const recentFailRate =
    history.length > 0
      ? history.filter((h) => (h.data as Record<string, boolean>).failed).length /
        history.length
      : 0;

  // If failing intermittently (30-70% fail rate), mark as flaky
  if (recentFailRate > 0.3 && recentFailRate < 0.7 && history.length >= 3) {
    addMemory({
      type: "flaky_test",
      testName,
      data: {
        failRate: recentFailRate,
        reason: `Intermittent failures: ${(recentFailRate * 100).toFixed(0)}% fail rate over ${history.length} runs`,
        avgDuration: duration,
      },
    });
    log.warn(
      `Flaky test detected: ${testName} (${(recentFailRate * 100).toFixed(0)}% fail rate)`
    );
  }
}

/**
 * Get risk-prioritized test order (riskiest first).
 */
export function prioritizeByRisk(
  tests: { name: string; code: string }[]
): { name: string; risk: number }[] {
  return tests
    .map((t) => ({
      name: t.name,
      risk: analyzeFlakiness(t.code, t.name).riskScore,
    }))
    .sort((a, b) => b.risk - a.risk);
}

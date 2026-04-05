import { findSelectorFixes, addMemory } from "../memory/store.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("LocatorHealing");

interface SelectorCandidate {
  selector: string;
  strategy: "testid" | "role" | "label" | "css" | "text";
  stability: number; // 0-1, higher is more stable
}

/**
 * Suggest a healed selector based on memory of past fixes
 * and selector stability ranking.
 */
export function suggestHealedSelector(
  brokenSelector: string,
  pageContext?: string
): SelectorCandidate | null {
  // Check memory for past fixes of this selector
  const pastFixes = findSelectorFixes(brokenSelector);
  if (pastFixes.length > 0) {
    const latest = pastFixes[0];
    const newSelector = (latest.data as Record<string, string>).newSelector;
    if (newSelector) {
      log.info(`Memory hit: "${brokenSelector}" → "${newSelector}"`);
      return {
        selector: newSelector,
        strategy: inferStrategy(newSelector),
        stability: 0.9,
      };
    }
  }

  // Suggest upgrade based on selector type
  const upgrade = suggestUpgrade(brokenSelector);
  if (upgrade) {
    log.info(`Suggested upgrade: "${brokenSelector}" → "${upgrade.selector}"`);
    return upgrade;
  }

  return null;
}

function inferStrategy(selector: string): SelectorCandidate["strategy"] {
  if (selector.includes("getByTestId")) return "testid";
  if (selector.includes("getByRole")) return "role";
  if (selector.includes("getByLabel")) return "label";
  if (selector.includes("getByText")) return "text";
  return "css";
}

function suggestUpgrade(selector: string): SelectorCandidate | null {
  // If using fragile CSS selector, suggest data-testid
  if (
    selector.match(/\.[a-zA-Z]+__[a-zA-Z]+/) || // BEM-like
    selector.match(/#[a-z]+-\d+/) ||              // generated IDs
    selector.match(/\nth-child\(\d+\)/)           // positional
  ) {
    return {
      selector: `[data-testid="TODO-add-testid"]`,
      strategy: "testid",
      stability: 0.95,
    };
  }
  return null;
}

/**
 * Record a successful selector heal for future reference.
 */
export function recordSelectorHeal(
  oldSelector: string,
  newSelector: string,
  page: string,
  reason: string
): void {
  addMemory({
    type: "selector_fix",
    data: {
      oldSelector,
      newSelector,
      page,
      reason,
      component: page,
      selector: oldSelector,
    },
  });
  log.info(`Recorded heal: "${oldSelector}" → "${newSelector}" on ${page}`);
}

/**
 * Rank selectors by stability for Playwright best practices.
 */
export function rankSelectorStability(selector: string): number {
  if (selector.includes("getByTestId") || selector.includes("data-testid"))
    return 0.95;
  if (selector.includes("getByRole")) return 0.9;
  if (selector.includes("getByLabel")) return 0.85;
  if (selector.includes("getByPlaceholder")) return 0.8;
  if (selector.includes("getByText")) return 0.7;
  if (selector.startsWith("#") && !selector.match(/-\d+$/)) return 0.6;
  if (selector.startsWith(".")) return 0.4;
  if (selector.includes("nth-child") || selector.includes("nth-of-type"))
    return 0.2;
  if (selector.startsWith("//")) return 0.15; // XPath
  return 0.3;
}

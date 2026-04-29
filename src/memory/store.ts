import fs from "fs";
import path from "path";
import { config } from "../config/index.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("Memory");

export interface MemoryEntry {
  id: string;
  type: "failure" | "selector_fix" | "rca_result" | "flaky_test" | "bug_filed";
  storyId?: string;
  testName?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface MemoryStore {
  entries: MemoryEntry[];
}

function memoryPath(): string {
  const dir = path.resolve(process.cwd(), config.memory.dir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "memory.json");
}

function loadStore(): MemoryStore {
  const filePath = memoryPath();
  if (!fs.existsSync(filePath)) {
    return { entries: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveStore(store: MemoryStore): void {
  fs.writeFileSync(memoryPath(), JSON.stringify(store, null, 2));
}

const MAX_MEMORY_ENTRIES = 1000;

export function addMemory(entry: Omit<MemoryEntry, "id" | "timestamp">): void {
  const store = loadStore();
  const newEntry: MemoryEntry = {
    ...entry,
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  store.entries.push(newEntry);
  // Trim oldest entries to prevent unbounded growth
  if (store.entries.length > MAX_MEMORY_ENTRIES) {
    store.entries = store.entries.slice(-MAX_MEMORY_ENTRIES);
  }
  saveStore(store);
  log.info(`Stored memory: ${newEntry.type} (${newEntry.id})`);
}

export function queryMemory(filter: {
  type?: MemoryEntry["type"];
  storyId?: string;
  testName?: string;
  limit?: number;
}): MemoryEntry[] {
  const store = loadStore();
  let results = store.entries;

  if (filter.type) {
    results = results.filter((e) => e.type === filter.type);
  }
  if (filter.storyId) {
    results = results.filter((e) => e.storyId === filter.storyId);
  }
  if (filter.testName) {
    results = results.filter((e) => e.testName === filter.testName);
  }

  // Most recent first
  results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (filter.limit) {
    results = results.slice(0, filter.limit);
  }
  return results;
}

/**
 * Find past selector fixes for a given page/component.
 * Useful for self-healing locators.
 */
export function findSelectorFixes(pageOrComponent: string): MemoryEntry[] {
  return queryMemory({ type: "selector_fix" }).filter((e) => {
    const data = e.data as Record<string, string>;
    return (
      data.page === pageOrComponent ||
      data.component === pageOrComponent ||
      data.selector?.includes(pageOrComponent)
    );
  });
}

/**
 * Check if a bug was already filed for a given test + root cause combo.
 */
export function bugAlreadyFiled(testName: string, rootCause: string): boolean {
  const existing = queryMemory({ type: "bug_filed", testName });
  return existing.some((e) => (e.data as Record<string, string>).rootCause === rootCause);
}

/**
 * Get flaky test history to assist in risk-based prioritization.
 */
export function getFlakyTests(limit: number = 20): MemoryEntry[] {
  return queryMemory({ type: "flaky_test", limit });
}

export function clearMemory(): void {
  const filePath = memoryPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  log.info("Memory cleared");
}

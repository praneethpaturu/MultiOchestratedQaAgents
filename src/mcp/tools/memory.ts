/**
 * MCP Tools: Memory
 *
 * saveMemory — Store data to the persistent memory layer
 * retrieveMemory — Retrieve data by key and/or type
 * findSimilarFailures — Search for historically similar failure patterns
 */

import fs from "fs";
import path from "path";
import { config } from "../../config/index.js";
import type { MCPToolDefinition, MCPToolHandler } from "../server.js";

const MEMORY_DIR = path.resolve(process.cwd(), config.memory.dir);
const MEMORY_FILES: Record<string, string> = {
  rca_result: "rcaMemory.json",
  selector_fix: "rcaMemory.json",
  flaky_test: "rcaMemory.json",
  test_design: "testResults.json",
  generated_tests: "testResults.json",
  requirement_analysis: "testResults.json",
  failure: "testResults.json",
  bug_filed: "testResults.json",
  clarification: "testResults.json",
  clarification_patterns: "testResults.json",
  pipeline_history: "testResults.json",
  missed_scenarios: "rcaMemory.json",
  reviewer_feedback: "rcaMemory.json",
  maintenance_fix: "rcaMemory.json",
  log: "logs.json",
};

interface MemoryEntry {
  id: string;
  key: string;
  type: string;
  data: unknown;
  timestamp: string;
}

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function loadFile(fileName: string): MemoryEntry[] {
  ensureDir();
  const filePath = path.join(MEMORY_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveFile(fileName: string, entries: MemoryEntry[]) {
  ensureDir();
  fs.writeFileSync(path.join(MEMORY_DIR, fileName), JSON.stringify(entries, null, 2));
}

function getFileName(type: string): string {
  return MEMORY_FILES[type] ?? "logs.json";
}

// ─── Tool Definitions ───

export const memoryToolDefinitions: MCPToolDefinition[] = [
  {
    name: "saveMemory",
    description: "Store data to the persistent JSON memory layer. Data is keyed by a unique key and typed for retrieval.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Unique memory key (e.g., 'requirements:12345')" },
        type: { type: "string", description: "Memory type: rca_result, selector_fix, flaky_test, test_design, generated_tests, requirement_analysis, failure, bug_filed, clarification, clarification_patterns, pipeline_history, missed_scenarios, reviewer_feedback, maintenance_fix" },
        data: { type: "object", description: "The data to store" },
      },
      required: ["key", "type", "data"],
    },
  },
  {
    name: "retrieveMemory",
    description: "Retrieve data from the memory layer by key prefix and/or type. Returns most recent entries first.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key or key prefix to search for" },
        type: { type: "string", description: "Filter by memory type" },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
    },
  },
  {
    name: "findSimilarFailures",
    description: "Search memory for historically similar test failure patterns based on error message signature. Used by the RCA agent for pattern matching.",
    inputSchema: {
      type: "object",
      properties: {
        errorSignature: { type: "string", description: "Error message or pattern to match against" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["errorSignature"],
    },
  },
];

// ─── Tool Handlers ───

export const memoryToolHandlers: Record<string, MCPToolHandler> = {
  async saveMemory(args: Record<string, unknown>) {
    const key = args.key as string;
    const type = args.type as string;
    const data = args.data;
    const fileName = getFileName(type);

    const entries = loadFile(fileName);

    // Upsert by key
    const existingIdx = entries.findIndex((e) => e.key === key);
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      key,
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      entries[existingIdx] = entry;
    } else {
      entries.push(entry);
    }

    saveFile(fileName, entries);
    return { stored: true, key, file: fileName };
  },

  async retrieveMemory(args: Record<string, unknown>) {
    const key = args.key as string | undefined;
    const type = args.type as string | undefined;
    const limit = (args.limit as number) ?? 20;

    // Search across all files or a specific one
    const fileNames = type ? [getFileName(type)] : Object.values(MEMORY_FILES);
    const unique = [...new Set(fileNames)];

    let results: MemoryEntry[] = [];
    for (const file of unique) {
      const entries = loadFile(file);
      results.push(...entries);
    }

    // Filter
    if (key) {
      results = results.filter((e) => e.key.startsWith(key) || e.key === key);
    }
    if (type) {
      results = results.filter((e) => e.type === type);
    }

    // Sort most recent first, limit
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    results = results.slice(0, limit);

    return { count: results.length, entries: results };
  },

  async findSimilarFailures(args: Record<string, unknown>) {
    const signature = (args.errorSignature as string).toLowerCase();
    const limit = (args.limit as number) ?? 10;

    // Search RCA memory and failure memory
    const rcaEntries = loadFile("rcaMemory.json");
    const testEntries = loadFile("testResults.json");
    const allEntries = [...rcaEntries, ...testEntries];

    const matches = allEntries
      .filter((e) => {
        const dataStr = JSON.stringify(e.data).toLowerCase();
        // Simple similarity: check if key error words appear
        const sigWords = signature.split(/\s+/).filter((w) => w.length > 3);
        const matchCount = sigWords.filter((w) => dataStr.includes(w)).length;
        return matchCount >= Math.max(1, sigWords.length * 0.3);
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);

    return { count: matches.length, matches };
  },
};

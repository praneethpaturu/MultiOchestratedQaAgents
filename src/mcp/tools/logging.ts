/**
 * MCP Tools: Logging
 *
 * logEvent — Log a structured event from any agent
 * getAgentLogs — Retrieve logs filtered by agent and/or event type
 */

import fs from "fs";
import path from "path";
import { config } from "../../config/index.js";
import { agentLogger } from "../../utils/logger.js";
import type { MCPToolDefinition, MCPToolHandler } from "../server.js";

const log = agentLogger("MCPLogging");
const LOGS_DIR = path.resolve(process.cwd(), config.memory.dir);
const LOGS_FILE = path.join(LOGS_DIR, "logs.json");

interface LogEntry {
  id: string;
  agent: string;
  event: string;
  data: unknown;
  timestamp: string;
}

function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function loadLogs(): LogEntry[] {
  ensureDir();
  if (!fs.existsSync(LOGS_FILE)) return [];
  return JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8"));
}

function saveLogs(entries: LogEntry[]) {
  ensureDir();
  // Keep only last 1000 entries to prevent unbounded growth
  const trimmed = entries.slice(-1000);
  fs.writeFileSync(LOGS_FILE, JSON.stringify(trimmed, null, 2));
}

// ─── Tool Definitions ───

export const loggingToolDefinitions: MCPToolDefinition[] = [
  {
    name: "logEvent",
    description: "Log a structured event from an agent. Events are stored persistently and displayed in the dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent slug (e.g., 'requirement-analyst', 'rca')" },
        event: { type: "string", description: "Event name (e.g., 'analysis_started', 'fix_applied', 'bug_created')" },
        data: { type: "object", description: "Arbitrary event data" },
      },
      required: ["agent", "event"],
    },
  },
  {
    name: "getAgentLogs",
    description: "Retrieve agent logs filtered by agent name, event type, and time range.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Filter by agent slug" },
        event: { type: "string", description: "Filter by event name" },
        limit: { type: "number", description: "Max results (default: 50)" },
        since: { type: "string", description: "ISO timestamp — only return logs after this time" },
      },
    },
  },
];

// ─── Tool Handlers ───

export const loggingToolHandlers: Record<string, MCPToolHandler> = {
  async logEvent(args: Record<string, unknown>) {
    const agent = args.agent as string;
    const event = args.event as string;
    const data = args.data ?? {};

    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agent,
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    const logs = loadLogs();
    logs.push(entry);
    saveLogs(logs);

    // Also emit to Winston for console visibility
    log.info(`[${agent}] ${event}: ${JSON.stringify(data).slice(0, 200)}`);

    return { logged: true, id: entry.id };
  },

  async getAgentLogs(args: Record<string, unknown>) {
    const agent = args.agent as string | undefined;
    const event = args.event as string | undefined;
    const limit = (args.limit as number) ?? 50;
    const since = args.since as string | undefined;

    let logs = loadLogs();

    if (agent) logs = logs.filter((l) => l.agent === agent);
    if (event) logs = logs.filter((l) => l.event === event);
    if (since) logs = logs.filter((l) => l.timestamp >= since);

    // Most recent first
    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    logs = logs.slice(0, limit);

    return { count: logs.length, logs };
  },
};

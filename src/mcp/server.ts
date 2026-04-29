/**
 * MCP (Model Context Protocol) Server
 *
 * Central tool registry that exposes all skills to agents.
 * Agents invoke tools through this server, which handles
 * routing, execution, error handling, and logging.
 *
 * Supports both:
 *   1. In-process usage (orchestrator calls executeTool directly)
 *   2. stdio-based MCP transport (for VS Code / external clients)
 */

import { agentLogger } from "../utils/logger.js";

// Import all tool modules
import { adoToolDefinitions, adoToolHandlers } from "./tools/ado.js";
import { playwrightToolDefinitions, playwrightToolHandlers } from "./tools/playwright.js";
import { memoryToolDefinitions, memoryToolHandlers } from "./tools/memory.js";
import { rcaToolDefinitions, rcaToolHandlers } from "./tools/rca.js";
import { loggingToolDefinitions, loggingToolHandlers } from "./tools/logging.js";

const log = agentLogger("MCPServer");

// ─── Types ───

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export type MCPToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface MCPToolResult {
  success: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

// ─── Tool Registry ───

const toolDefinitions = new Map<string, MCPToolDefinition>();
const toolHandlers = new Map<string, MCPToolHandler>();

function registerTools(
  definitions: MCPToolDefinition[],
  handlers: Record<string, MCPToolHandler>
) {
  for (const def of definitions) {
    toolDefinitions.set(def.name, def);
    const handler = handlers[def.name];
    if (handler) {
      toolHandlers.set(def.name, handler);
    } else {
      log.warn(`No handler found for tool: ${def.name}`);
    }
  }
}

// ─── Initialize ───

let initialized = false;

export function initMCPServer(): void {
  if (initialized) return;

  log.info("Initializing MCP tool registry...");

  registerTools(adoToolDefinitions, adoToolHandlers);
  registerTools(playwrightToolDefinitions, playwrightToolHandlers);
  registerTools(memoryToolDefinitions, memoryToolHandlers);
  registerTools(rcaToolDefinitions, rcaToolHandlers);
  registerTools(loggingToolDefinitions, loggingToolHandlers);

  initialized = true;
  log.info(`MCP server ready: ${toolDefinitions.size} tools registered`);
  for (const [name] of toolDefinitions) {
    log.info(`  ▸ ${name}`);
  }
}

// ─── List Tools (MCP protocol: tools/list) ───

export function listTools(): MCPToolDefinition[] {
  return Array.from(toolDefinitions.values());
}

// ─── Execute Tool (MCP protocol: tools/call) ───

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<MCPToolResult> {
  const start = Date.now();

  const handler = toolHandlers.get(toolName);
  if (!handler) {
    return {
      success: false,
      toolName,
      error: `Unknown tool: ${toolName}. Available: ${Array.from(toolDefinitions.keys()).join(", ")}`,
      durationMs: Date.now() - start,
    };
  }

  log.info(`Executing tool: ${toolName}(${JSON.stringify(args).slice(0, 150)})`);

  try {
    const result = await handler(args);
    const durationMs = Date.now() - start;
    log.info(`Tool ${toolName} completed in ${durationMs}ms`);
    return { success: true, toolName, result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = (err as Error).message;
    log.error(`Tool ${toolName} failed: ${error}`);
    return { success: false, toolName, error, durationMs };
  }
}

// ─── Tool Definition Lookup ───

export function getToolDefinition(name: string): MCPToolDefinition | undefined {
  return toolDefinitions.get(name);
}

// ─── Build LLM-compatible tool list ───

export function getToolsForLLM(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: MCPToolDefinition["inputSchema"] };
}> {
  return Array.from(toolDefinitions.values()).map((def) => ({
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }));
}

// ─── stdio MCP transport (for VS Code integration) ───

export async function startStdioTransport(preBuffered?: Buffer[]): Promise<void> {
  log.info("Starting MCP stdio transport...");

  let buffer = Buffer.alloc(0);
  let processing = false;

  async function processBuffer(): Promise<void> {
    if (processing) return;
    processing = true;

    try {
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;

        const header = buffer.subarray(0, headerEnd).toString("utf-8");
        const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!contentLengthMatch) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }

        const contentLength = parseInt(contentLengthMatch[1], 10);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + contentLength) break;

        const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf-8");
        buffer = buffer.subarray(bodyStart + contentLength);

        try {
          const request = JSON.parse(body);
          log.info(`stdio recv: ${request.method ?? "response"} (id=${request.id ?? "n/a"})`);
          const response = await handleJsonRpc(request);
          if (response) {
            const responseBody = JSON.stringify(response);
            const responseBytes = Buffer.byteLength(responseBody, "utf-8");
            process.stdout.write(
              `Content-Length: ${responseBytes}\r\n\r\n${responseBody}`
            );
            log.info(`stdio send: id=${response.id} (${responseBytes} bytes)`);
          }
        } catch (err) {
          log.error(`stdio parse error: ${(err as Error).message}`);
        }
      }
    } finally {
      processing = false;
    }
  }

  // Replay any data that arrived before this function was called
  if (preBuffered && preBuffered.length > 0) {
    buffer = Buffer.concat(preBuffered);
    log.info(`Replaying ${buffer.length} pre-buffered bytes`);
  }

  // Listen for new data
  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    processBuffer();
  });

  process.stdin.on("end", () => {
    log.info("MCP stdio transport closed");
  });

  // Process any pre-buffered data now
  if (buffer.length > 0) {
    processBuffer();
  }
}

async function handleJsonRpc(request: any): Promise<any> {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "qa-agent-mcp", version: "2.0.0" },
        },
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: listTools() },
      };

    case "tools/call": {
      const { name, arguments: args } = params;
      const result = await executeTool(name, args ?? {});
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: result.success
                ? JSON.stringify(result.result)
                : `Error: ${result.error}`,
            },
          ],
          isError: !result.success,
        },
      };
    }

    case "notifications/initialized":
      return null; // No response needed

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

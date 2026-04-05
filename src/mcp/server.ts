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

export function initMCPServer(): void {
  log.info("Initializing MCP tool registry...");

  registerTools(adoToolDefinitions, adoToolHandlers);
  registerTools(playwrightToolDefinitions, playwrightToolHandlers);
  registerTools(memoryToolDefinitions, memoryToolHandlers);
  registerTools(rcaToolDefinitions, rcaToolHandlers);
  registerTools(loggingToolDefinitions, loggingToolHandlers);

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

export async function startStdioTransport(): Promise<void> {
  log.info("Starting MCP stdio transport...");

  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;

    // Process complete JSON-RPC messages
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) break;

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) break;

      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);

      try {
        const request = JSON.parse(body);
        const response = await handleJsonRpc(request);
        if (response) {
          const responseBody = JSON.stringify(response);
          process.stdout.write(
            `Content-Length: ${Buffer.byteLength(responseBody)}\r\n\r\n${responseBody}`
          );
        }
      } catch (err) {
        log.error(`stdio parse error: ${(err as Error).message}`);
      }
    }
  });

  process.stdin.on("end", () => {
    log.info("MCP stdio transport closed");
  });
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

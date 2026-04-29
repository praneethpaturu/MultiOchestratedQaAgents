/**
 * Agent Loader — Parses .md Copilot agent definitions.
 *
 * Reads agent markdown files and extracts structured metadata:
 * role, model, inputs, outputs, MCP tools used, and instructions.
 */

import fs from "fs";
import path from "path";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("AgentLoader");

export interface AgentDefinition {
  slug: string;
  name: string;
  role: string;
  model: string;
  inputs: string;
  outputs: string;
  mcpTools: string[];
  instructions: string;
  constraints: string;
  rawMarkdown: string;
}

const AGENTS_DIR = path.resolve(process.cwd(), "agents");

/**
 * Load all .md agent definitions from the agents/ directory.
 */
export function loadAllAgents(): AgentDefinition[] {
  if (!fs.existsSync(AGENTS_DIR)) {
    log.warn(`Agents directory not found: ${AGENTS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  const agents: AgentDefinition[] = [];

  for (const file of files) {
    try {
      const agent = loadAgent(path.join(AGENTS_DIR, file));
      agents.push(agent);
      log.info(`Loaded agent: ${agent.name} (${agent.mcpTools.length} tools)`);
    } catch (err) {
      log.error(`Failed to load agent ${file}: ${(err as Error).message}`);
    }
  }

  log.info(`Loaded ${agents.length} agents total`);
  return agents;
}

/**
 * Load a single .md agent definition.
 */
export function loadAgent(filePath: string): AgentDefinition {
  const raw = fs.readFileSync(filePath, "utf-8");
  const slug = path.basename(filePath, ".md");

  return {
    slug,
    name: extractSection(raw, "# Agent:") || slug,
    role: extractSection(raw, "## Role") || "",
    model: extractSection(raw, "## Model") || "gpt-4o",
    inputs: extractSection(raw, "## Inputs") || "",
    outputs: extractSection(raw, "## Outputs") || "",
    mcpTools: extractToolList(raw),
    instructions: extractSection(raw, "## Instructions") || "",
    constraints: extractSection(raw, "## Constraints") || "",
    rawMarkdown: raw,
  };
}

/**
 * Get a specific agent by slug.
 */
export function getAgentBySlug(slug: string): AgentDefinition | undefined {
  const agents = loadAllAgents();
  return agents.find((a) => a.slug === slug);
}

// ─── Parsing Helpers ───

function extractSection(md: string, heading: string): string {
  // Find the heading
  const headingLevel = heading.split(" ")[0]; // "##" or "#"
  const regex = new RegExp(
    `^${escapeRegex(heading)}\\s*(.*)$`,
    "mi"
  );
  const match = md.match(regex);
  if (!match) return "";

  const startIdx = md.indexOf(match[0]) + match[0].length;

  // Find the next heading at the same or higher level
  const nextHeadingRegex = new RegExp(
    `^#{1,${headingLevel.length}}\\s`,
    "m"
  );
  const rest = md.slice(startIdx);
  const nextMatch = rest.match(nextHeadingRegex);
  const endIdx = nextMatch ? startIdx + rest.indexOf(nextMatch[0]) : md.length;

  const content = md.slice(startIdx, endIdx).trim();

  // For the title line (# Agent: Name), return just the name part
  if (heading === "# Agent:") {
    return match[1]?.trim() || content.split("\n")[0];
  }

  return content;
}

function extractToolList(md: string): string[] {
  const lines = md.split("\n");
  const tools: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+MCP\s+Tools\s+Used\s*$/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s/.test(line)) break;
    if (!inSection) continue;
    const m = line.match(/^[-*]\s+`?(\w+)`?/);
    if (m) tools.push(m[1]);
  }
  return tools;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

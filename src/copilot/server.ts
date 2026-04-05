/**
 * GitHub Copilot Extension Server
 *
 * Express server that implements the Copilot Extensions protocol
 * for VS Code Copilot Chat. Users invoke with @qa-agent in chat.
 *
 * Start: npm run serve
 * Dev:   npm run serve:dev
 */

import "dotenv/config";
import express from "express";
import { Octokit } from "@octokit/core";
import { getUserMessage, getUserConfirmation } from "@copilot-extensions/preview-sdk";
import { verifyCopilotRequest, extractToken } from "./verification.js";
import { resolveHandler, skills } from "./handlers/index.js";
import {
  initSSE,
  streamText,
  streamSection,
  streamCode,
  endStream,
  streamErrorAndEnd,
} from "./streaming.js";
import { agentLogger } from "../utils/logger.js";
import type { CopilotAgentContext } from "./types.js";

const log = agentLogger("CopilotServer");
const app = express();

// IMPORTANT: Capture raw body as text for signature verification
app.use(express.text({ type: "application/json" }));

// ─── Health Check ───
app.get("/", (_req, res) => {
  res.json({
    name: "qa-agent",
    description: "Multi-Agent Orchestrated QA Platform — GitHub Copilot Extension",
    version: "2.0.0",
    status: "running",
    skills: skills.map((s) => ({
      command: s.command,
      description: s.description,
      usage: s.usage,
    })),
  });
});

// ─── Main Copilot Extension Endpoint ───
app.post("/", async (req, res) => {
  const token = extractToken(req);

  // 1. Verify request signature
  const verification = await verifyCopilotRequest(req);
  if (!verification.valid || !verification.payload) {
    log.warn(`Rejected: ${verification.error}`);
    res.status(401).json({ error: verification.error });
    return;
  }

  const payload = verification.payload;
  const threadId = payload.copilot_thread_id ?? "default";

  // 2. Identify user (optional, for logging)
  let username = "unknown";
  if (token) {
    try {
      const octokit = new Octokit({ auth: token });
      const { data: user } = await octokit.request("GET /user");
      username = user.login;
    } catch {
      // Non-critical
    }
  }

  // 3. Extract user message
  let userMessage: string;
  try {
    userMessage = getUserMessage(payload as any);
  } catch {
    // Fallback extraction
    const lastMsg = payload.messages.filter((m) => m.role === "user").pop();
    userMessage = lastMsg?.content ?? "";
  }

  log.info(`@${username} → "${userMessage.slice(0, 100)}"`);

  // 4. Handle confirmation responses
  try {
    const confirmation = getUserConfirmation(payload as any);
    if (confirmation) {
      initSSE(res);
      if ((confirmation as any).accepted) {
        streamText(res, "✅ Confirmed. Proceeding with the action.\n");
      } else {
        streamText(res, "❌ Cancelled. No action taken.\n");
      }
      endStream(res);
      return;
    }
  } catch {
    // No confirmation — proceed normally
  }

  // 5. Handle /help command
  if (userMessage.trim() === "/help" || userMessage.trim() === "help") {
    initSSE(res);
    streamSection(res, "QA Agent — Available Commands", "");
    streamText(res, "| Command | Description | Usage |\n|---|---|---|\n");
    for (const skill of skills) {
      streamText(res, `| \`${skill.command}\` | ${skill.description} | \`${skill.usage}\` |\n`);
    }
    streamText(res, `\n**Agents:** Orchestrator, Clarifier, Requirement Analyst, Test Designer, Automation Engineer, Maintenance, RCA, Reviewer\n`);
    streamText(res, `\nType any command or describe what you need in natural language.\n`);
    endStream(res);
    return;
  }

  // 6. Route to the appropriate agent handler
  const { handler, cleanMessage } = resolveHandler(userMessage);
  log.info(`Routing to @${handler.slug}`);

  const ctx: CopilotAgentContext = {
    payload,
    token,
    userMessage: cleanMessage || userMessage,
    threadId,
    res,
    username,
  };

  try {
    await handler.handle(ctx);
  } catch (err) {
    log.error(`Handler @${handler.slug} crashed: ${(err as Error).message}`);
    // Try to send error if headers not yet sent
    if (!res.headersSent) {
      streamErrorAndEnd(res, `Agent @${handler.slug} failed: ${(err as Error).message}`);
    }
  }
});

// ─── Callback endpoint (for GitHub App OAuth) ───
app.get("/callback", (req, res) => {
  res.send("GitHub App authorized. You can close this window.");
});

// ─── Start Server ───
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  log.info(`════════════════════════════════════════════════`);
  log.info(`  QA Agent — Copilot Extension Server`);
  log.info(`  Listening on http://localhost:${PORT}`);
  log.info(`  Health check: GET /`);
  log.info(`  Copilot endpoint: POST /`);
  log.info(`════════════════════════════════════════════════`);
  log.info(`  Skills: ${skills.map((s) => s.command).join(", ")}`);
  log.info(`════════════════════════════════════════════════`);
});

export { app };

/**
 * SSE Streaming Helpers for GitHub Copilot Extension
 *
 * Wraps the @copilot-extensions/preview-sdk event builders
 * with convenience methods for common agent response patterns.
 */

import {
  createAckEvent,
  createTextEvent,
  createDoneEvent,
  createConfirmationEvent,
  createReferencesEvent,
  createErrorsEvent,
} from "@copilot-extensions/preview-sdk";
import type { Response } from "express";

/**
 * Initialize an SSE response — set headers and send the ack event.
 */
export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write(createAckEvent());
}

/**
 * Stream a text message chunk to the client.
 */
export function streamText(res: Response, text: string): void {
  res.write(createTextEvent(text));
}

/**
 * Stream a full markdown block — splits into lines for smooth rendering.
 */
export function streamMarkdown(res: Response, markdown: string): void {
  const lines = markdown.split("\n");
  for (const line of lines) {
    res.write(createTextEvent(line + "\n"));
  }
}

/**
 * Stream a heading + content section.
 */
export function streamSection(res: Response, heading: string, content: string): void {
  res.write(createTextEvent(`\n### ${heading}\n\n`));
  res.write(createTextEvent(content + "\n"));
}

/**
 * Stream a status update line (bold prefix).
 */
export function streamStatus(res: Response, agent: string, status: string): void {
  res.write(createTextEvent(`\n**@${agent}** — ${status}\n`));
}

/**
 * Stream a code block.
 */
export function streamCode(res: Response, code: string, language: string = "typescript"): void {
  res.write(createTextEvent(`\n\`\`\`${language}\n${code}\n\`\`\`\n`));
}

/**
 * Stream a progress step.
 */
export function streamStep(res: Response, step: number, total: number, description: string): void {
  res.write(createTextEvent(`\n**Step ${step}/${total}:** ${description}\n`));
}

/**
 * Ask the user for confirmation before proceeding.
 */
export function streamConfirmation(
  res: Response,
  id: string,
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  res.write(
    createConfirmationEvent({
      id,
      title,
      message,
      metadata,
    })
  );
}

/**
 * Attach references (links to ADO stories, bugs, files, etc.).
 */
export function streamReferences(
  res: Response,
  references: Array<{
    type: string;
    id: string;
    title: string;
    url?: string;
    icon?: string;
  }>
): void {
  res.write(
    createReferencesEvent(
      references.map((ref) => ({
        type: ref.type,
        id: ref.id,
        is_implicit: false,
        metadata: {
          display_name: ref.title,
          display_icon: ref.icon ?? "file",
          display_url: ref.url ?? "",
        },
      }))
    )
  );
}

/**
 * Stream an error event.
 */
export function streamError(res: Response, message: string, code: string = "AGENT_ERROR"): void {
  res.write(
    createErrorsEvent([
      {
        type: "agent",
        code,
        message,
        identifier: code.toLowerCase().replace(/\s+/g, "-"),
      },
    ])
  );
}

/**
 * End the SSE stream — MUST be called last.
 */
export function endStream(res: Response): void {
  res.end(createDoneEvent());
}

/**
 * Convenience: stream an error and end.
 */
export function streamErrorAndEnd(res: Response, message: string, code?: string): void {
  streamError(res, message, code);
  endStream(res);
}

/**
 * GitHub Copilot Extension — Request Signature Verification
 *
 * Verifies that incoming requests genuinely come from GitHub Copilot
 * using the asymmetric key-based signature scheme.
 */

import { verifyAndParseRequest } from "@copilot-extensions/preview-sdk";
import type { Request } from "express";
import { CopilotRequestPayload } from "./types.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("CopilotVerify");

// Cache verification keys across requests
let keyCache: unknown = undefined;

export interface VerificationResult {
  valid: boolean;
  payload?: CopilotRequestPayload;
  error?: string;
}

/**
 * Verify and parse a Copilot Extension request.
 *
 * In development mode (COPILOT_SKIP_VERIFY=true), signature
 * verification is bypassed for local testing.
 */
export async function verifyCopilotRequest(req: Request): Promise<VerificationResult> {
  const rawBody = req.body as string;
  const signature = req.headers["github-public-key-signature"] as string;
  const keyID = req.headers["github-public-key-identifier"] as string;
  const token = req.headers["x-github-token"] as string;

  // Development mode — skip verification for local testing
  if (process.env.COPILOT_SKIP_VERIFY === "true") {
    log.warn("Skipping signature verification (COPILOT_SKIP_VERIFY=true)");
    try {
      const payload = JSON.parse(rawBody) as CopilotRequestPayload;
      return { valid: true, payload };
    } catch (err) {
      return { valid: false, error: "Invalid JSON body" };
    }
  }

  // Production — verify the GitHub signature
  if (!signature || !keyID) {
    return {
      valid: false,
      error: "Missing github-public-key-signature or github-public-key-identifier headers",
    };
  }

  try {
    const result = await verifyAndParseRequest(rawBody, signature, keyID, {
      token,
    });

    if (!result.isValidRequest) {
      log.warn("Request signature verification failed");
      return { valid: false, error: "Signature verification failed" };
    }

    // Cache for subsequent requests
    keyCache = (result as any).cache ?? keyCache;

    log.info("Request signature verified successfully");
    return { valid: true, payload: result.payload as unknown as CopilotRequestPayload };
  } catch (err) {
    log.error(`Verification error: ${(err as Error).message}`);
    return { valid: false, error: (err as Error).message };
  }
}

/**
 * Extract the GitHub API token from the request.
 */
export function extractToken(req: Request): string {
  return (req.headers["x-github-token"] as string) ?? "";
}

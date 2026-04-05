/**
 * MCP Tools: Root Cause Analysis
 *
 * analyzeLogs — Deep-parse Playwright error logs and stack traces
 * calculateConfidence — Compute RCA confidence score based on evidence
 */

import type { MCPToolDefinition, MCPToolHandler } from "../server.js";
import { routeToModel } from "../../utils/router.js";
import { extractJSON } from "../../utils/helpers.js";

// ─── Tool Definitions ───

export const rcaToolDefinitions: MCPToolDefinition[] = [
  {
    name: "analyzeLogs",
    description: "Deep-parse Playwright error logs, stack traces, and test code to identify failure patterns. Returns structured analysis with category classification.",
    inputSchema: {
      type: "object",
      properties: {
        failures: { type: "array", description: "Array of test failure objects with errorMessage, errorStack, testName" },
        testCode: { type: "string", description: "The test source code" },
        analysisDepth: { type: "string", description: "Analysis depth level", enum: ["quick", "deep"] },
      },
      required: ["failures"],
    },
  },
  {
    name: "calculateConfidence",
    description: "Compute a confidence score (0.0-1.0) for an RCA classification based on evidence strength, historical pattern matches, and maintenance attempt count.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "RCA category classification", enum: ["UI_CHANGE", "LOCATOR_BROKEN", "API_FAILURE", "DATA_ISSUE", "ENVIRONMENT_ISSUE", "TEST_BUG", "PRODUCT_BUG"] },
        evidenceStrength: { type: "string", description: "Strength of the evidence for classification", enum: ["strong", "moderate", "weak"] },
        historicalMatches: { type: "number", description: "Number of similar past failures found" },
        maintenanceAttempts: { type: "number", description: "How many fix attempts were already made" },
      },
      required: ["category", "evidenceStrength"],
    },
  },
];

// ─── Tool Handlers ───

export const rcaToolHandlers: Record<string, MCPToolHandler> = {
  async analyzeLogs(args: Record<string, unknown>) {
    const failures = args.failures as unknown[];
    const testCode = (args.testCode as string) ?? "";
    const depth = (args.analysisDepth as string) ?? "deep";

    // Use the RCA model for deep analysis
    const response = await routeToModel({
      role: "rca",
      systemPrompt: `You are a deep Root Cause Analysis specialist for Playwright UI tests.
Analyze the failures and classify each into: UI_CHANGE, LOCATOR_BROKEN, API_FAILURE, DATA_ISSUE, ENVIRONMENT_ISSUE, TEST_BUG, or PRODUCT_BUG.

Respond with JSON:
{
  "analyses": [
    {
      "testName": "string",
      "category": "string",
      "rootCause": "string",
      "evidenceStrength": "strong | moderate | weak",
      "suggestedFix": "string",
      "isProductBug": "boolean",
      "details": "string"
    }
  ]
}`,
      userPrompt: `Analyze these ${depth === "deep" ? "persistent" : ""} test failures:

## Failures
${JSON.stringify(failures, null, 2)}

## Test Code
\`\`\`ts
${testCode.slice(0, 3000)}
\`\`\`

Classify and analyze. Respond with JSON only.`,
      temperature: 0.1,
      maxTokens: 4096,
    });

    return extractJSON(response.content);
  },

  async calculateConfidence(args: Record<string, unknown>) {
    const category = args.category as string;
    const strength = args.evidenceStrength as string;
    const matches = (args.historicalMatches as number) ?? 0;
    const attempts = (args.maintenanceAttempts as number) ?? 0;

    // Base confidence from evidence strength
    let confidence: number;
    switch (strength) {
      case "strong":
        confidence = 0.85;
        break;
      case "moderate":
        confidence = 0.6;
        break;
      default:
        confidence = 0.35;
    }

    // Boost from historical pattern matches
    if (matches > 0) {
      confidence += Math.min(0.1, matches * 0.02);
    }

    // Boost if maintenance already tried and failed
    if (attempts >= 2) {
      confidence += 0.05;
    }
    if (attempts >= 3) {
      confidence += 0.05;
    }

    // PRODUCT_BUG needs higher bar
    if (category === "PRODUCT_BUG" && strength !== "strong") {
      confidence = Math.min(confidence, 0.7);
    }

    // Clamp
    confidence = Math.max(0.1, Math.min(1.0, confidence));

    // Determine action
    let action: string;
    switch (category) {
      case "PRODUCT_BUG":
        action = "create_bug";
        break;
      case "ENVIRONMENT_ISSUE":
        action = "flag_infra";
        break;
      case "DATA_ISSUE":
        action = "retry";
        break;
      default:
        action = "fix_test";
    }

    return {
      confidence: Math.round(confidence * 100) / 100,
      category,
      action,
      reasoning: `Evidence: ${strength}, ${matches} historical matches, ${attempts} maintenance attempts`,
    };
  },
};

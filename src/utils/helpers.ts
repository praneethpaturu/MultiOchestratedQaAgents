/**
 * Extract JSON from an LLM response that may contain markdown fences.
 */
export function extractJSON<T = unknown>(text: string): T {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // noop
  }

  // Try extracting from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Try finding JSON object/array boundaries
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }

  throw new Error(`Failed to extract JSON from LLM response:\n${text.slice(0, 200)}`);
}

/**
 * Truncate text to a max length, appending ellipsis if truncated.
 */
export function truncate(text: string, maxLen: number = 500): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a slug from text for file naming.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still run a comparison so the timing does not leak the length.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Pull the client credential out of a request.
 *
 * Both dialects are accepted so the same gateway works for OpenAI SDKs
 * (`Authorization: Bearer`) and Anthropic SDKs (`x-api-key`).
 */
export function extractApiKey(headers: {
  authorization?: string | string[] | undefined;
  "x-api-key"?: string | string[] | undefined;
}): string | null {
  const auth = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = Array.isArray(headers["x-api-key"])
    ? headers["x-api-key"][0]
    : headers["x-api-key"];
  return apiKey?.trim() || null;
}

export function isAuthorized(
  configuredKeys: string[],
  presented: string | null,
): boolean {
  if (configuredKeys.length === 0) return true;
  if (!presented) return false;
  return configuredKeys.some((key) => safeEqual(key, presented));
}

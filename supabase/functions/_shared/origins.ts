// Exact-match origin allow-list. There is no wildcard support on purpose.

/** Parses the ALLOWED_ORIGINS secret (comma-separated). Invalid entries and "*" are dropped (fail closed). */
export function parseOrigins(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\/[^\s/*]+$/.test(entry)); // scheme://host[:port], no path, no wildcard
}

/** Returns the origin to echo back, or null when it is not on the list. */
export function matchOrigin(origin: string | null, allowed: string[]): string | null {
  return origin !== null && allowed.includes(origin) ? origin : null;
}

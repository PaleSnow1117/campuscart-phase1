import { json, type CorsHeaders } from "./cors.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** A dependency (Firestore, Supabase Storage, Google) failed. The caller should fail closed and retry later. */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

export function errorResponse(fn: string, error: unknown, cors: CorsHeaders): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status, cors);
  // Log the kind of failure only. Never log tokens, URLs or file contents.
  // UpstreamError messages are fixed strings (e.g. "Firestore write failed (403)"): safe to log, and they make a
  // misconfigured rule or attestor easy to diagnose. Nothing from the request, token or file is ever logged.
  console.error(`${fn} failed:`, error instanceof UpstreamError ? error.message : error instanceof Error ? error.name : "unknown");
  if (error instanceof UpstreamError) return json({ error: "Something went wrong on our side. Please try again." }, 503, cors);
  return json({ error: "Something went wrong. Please try again." }, 500, cors);
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new UpstreamError(`Missing server setting ${name}`);
  return value;
}

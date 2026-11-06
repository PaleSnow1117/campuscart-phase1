import { matchOrigin, parseOrigins } from "./origins.ts";

export type CorsHeaders = Record<string, string>;

export function json(body: unknown, status: number, cors: CorsHeaders): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Wraps a handler with strict CORS:
 * - A browser request whose Origin is not on ALLOWED_ORIGINS is refused (403) and gets no CORS headers.
 * - Allowed origins get exactly that origin echoed back (never "*").
 * - Requests with no Origin header (non-browser clients) pass through, but still need a valid Firebase token.
 * CORS is a browser safeguard only. Authorization is the token check inside each handler.
 */
export async function withCors(
  req: Request,
  methods: string[],
  handler: (cors: CorsHeaders) => Promise<Response>,
): Promise<Response> {
  const origin = req.headers.get("Origin");
  let cors: CorsHeaders = {};
  if (origin !== null) {
    const allowed = matchOrigin(origin, parseOrigins(Deno.env.get("ALLOWED_ORIGINS")));
    if (!allowed) return json({ error: "Origin not allowed." }, 403, {});
    cors = { "Access-Control-Allow-Origin": allowed, "Vary": "Origin" };
  }
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", "),
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  if (!methods.includes(req.method)) return json({ error: "Method not allowed." }, 405, cors);
  return await handler(cors);
}

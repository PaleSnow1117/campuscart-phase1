import { decodeProtectedHeader, importX509, jwtVerify } from "npm:jose@5";
import { HttpError } from "./errors.ts";

// Verifies Firebase ID tokens following Firebase's documented rules:
//  - header: alg RS256, kid present and matching one of Google's published signing certificates
//  - payload: aud == project id, iss == https://securetoken.google.com/<project id>,
//    sub non-empty string, exp in the future, auth_time in the past
//  - signature checked against Google's public certificates
// Limitation: this does not check whether the account was disabled or revoked since the token
// was issued, so a token stays acceptable until it expires (at most one hour).

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const MAX_TOKEN_LENGTH = 4096;
const CLOCK_TOLERANCE_SECONDS = 5;

export type SigningKey = Awaited<ReturnType<typeof importX509>>;
export type KeyResolver = (kid: string) => Promise<SigningKey | null>;
export type VerifiedUser = { uid: string; token: string };

let certCache: { certs: Record<string, string>; expiresAt: number; fetchedAt: number } | null = null;

async function loadCerts(force: boolean): Promise<Record<string, string>> {
  const now = Date.now();
  if (certCache && now < certCache.expiresAt && !force) return certCache.certs;
  // A forced refresh (unknown kid) is limited to once a minute so random kids can't hammer Google.
  if (certCache && force && now - certCache.fetchedAt < 60_000) return certCache.certs;
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new HttpError(503, "Could not verify your login right now. Please try again.");
  const certs = (await response.json()) as Record<string, string>;
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certCache = { certs, fetchedAt: now, expiresAt: now + Math.min(maxAge, 86_400) * 1000 };
  return certs;
}

export const googleKeyResolver: KeyResolver = async (kid) => {
  let pem = (await loadCerts(false))[kid];
  if (!pem) pem = (await loadCerts(true))[kid];
  return pem ? await importX509(pem, "RS256") : null;
};

export function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!match || match[1].length > MAX_TOKEN_LENGTH) throw new HttpError(401, "Please log in again.");
  return match[1];
}

/** Throws HttpError(401) for any token that is not a currently valid Firebase ID token for this project. */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  getKey: KeyResolver = googleKeyResolver,
  nowMs: number = Date.now(),
): Promise<VerifiedUser> {
  const unauthorized = new HttpError(401, "Please log in again.");
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw unauthorized;
    const key = await getKey(header.kid);
    if (!key) throw unauthorized;
    const { payload } = await jwtVerify(token, key, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["exp", "iat", "sub", "auth_time"],
      currentDate: new Date(nowMs),
    });
    const nowSeconds = Math.floor(nowMs / 1000);
    if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) throw unauthorized;
    if (typeof payload.auth_time !== "number" || payload.auth_time > nowSeconds + CLOCK_TOLERANCE_SECONDS) throw unauthorized;
    return { uid: payload.sub, token };
  } catch (error) {
    if (error instanceof HttpError) throw error; // includes 503 from the certificate fetch
    throw unauthorized; // bad signature, expired, wrong issuer/audience, malformed, ...
  }
}

export async function requireUser(req: Request, projectId: string): Promise<VerifiedUser> {
  return await verifyFirebaseToken(bearerToken(req), projectId);
}

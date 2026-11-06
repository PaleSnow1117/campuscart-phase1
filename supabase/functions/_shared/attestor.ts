import { HttpError, requireEnv, UpstreamError } from "./errors.ts";

// "Attestor" = a dedicated, low-privilege Firebase account used ONLY by verify-cor to record that the
// trusted backend saw a valid COR (users/{uid}.corVerifiedAt). Firestore rules let that account change
// nothing except corVerifiedAt, and let the admin approve a student only if corVerifiedAt is set.
// This avoids storing a Firebase service-account key anywhere.

let cached: { idToken: string; expiresAt: number } | null = null;

async function attestorToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.idToken;
  const apiKey = requireEnv("FIREBASE_WEB_API_KEY");
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: requireEnv("ATTESTOR_EMAIL"), password: requireEnv("ATTESTOR_PASSWORD"), returnSecureToken: true }),
    });
  } catch {
    throw new UpstreamError("Identity service unreachable");
  }
  if (!response.ok) throw new UpstreamError(`Attestor sign-in failed (${response.status})`);
  const body = (await response.json()) as { idToken?: string; expiresIn?: string };
  if (!body.idToken) throw new UpstreamError("Attestor sign-in returned no token");
  cached = { idToken: body.idToken, expiresAt: Date.now() + Math.max(60, Number(body.expiresIn ?? 3600) - 120) * 1000 };
  return body.idToken;
}

/** Sets users/{studentUid}.corVerifiedAt. Only updates an existing profile and touches only that one field. */
export async function markCorVerified(projectId: string, studentUid: string): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${studentUid}` +
    `?updateMask.fieldPaths=corVerifiedAt&currentDocument.exists=true`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${await attestorToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { corVerifiedAt: { timestampValue: new Date().toISOString() } } }),
    });
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError("Firestore unreachable");
  }
  await response.body?.cancel();
  if (response.status === 404) throw new HttpError(404, "That student has no profile.");
  if (!response.ok) {
    cached = null; // force a fresh attestor sign-in next time in case the token was the problem
    throw new UpstreamError(`Firestore write failed (${response.status})`);
  }
}

import { UpstreamError } from "./errors.ts";

// Reads Firestore over REST using the CALLER's own Firebase ID token, so Firestore Security Rules
// decide what the caller may see. No service account is involved.

const base = (projectId: string) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function statusOf(projectId: string, path: string, idToken: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(`${base(projectId)}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new UpstreamError("Firestore unreachable");
  }
  await response.body?.cancel();
  return response.status;
}

/** True only if admins/{uid} can be read by the caller (the rules allow exactly that for the admin). Fails closed. */
export async function isAdmin(projectId: string, uid: string, idToken: string): Promise<boolean> {
  const status = await statusOf(projectId, `admins/${uid}`, idToken);
  if (status === 200) return true;
  if (status === 403 || status === 404) return false;
  throw new UpstreamError(`Unexpected Firestore status ${status}`);
}

/** Whether the caller's own profile document exists. */
export async function profileExists(projectId: string, uid: string, idToken: string): Promise<boolean> {
  const status = await statusOf(projectId, `users/${uid}`, idToken);
  if (status === 200) return true;
  if (status === 404) return false;
  throw new UpstreamError(`Unexpected Firestore status ${status}`);
}

import { functionsUrl } from "./firebase";

// Certificate of Registration handling. The file is sent to a Supabase Edge Function together with the
// student's Firebase ID token. The function verifies the token, decides the storage path itself and stores
// the file in a PRIVATE bucket. The browser never touches Supabase Storage and holds no Supabase key.
// Firestore keeps only the object PATH, never a URL and never the file.

export const COR_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (also enforced by the function)
export const COR_MAX_LABEL = "10 MB";
/** Value for <input accept>. */
export const COR_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
const ALLOWED_TYPES = new Set(Object.values(TYPE_BY_EXTENSION));

/** The object path inside the private bucket. It must match what the Edge Function derives from the token. */
export function corStoragePath(uid: string): string {
  return `${uid}/cor`;
}

function corContentType(file: Pick<File, "name" | "type">): string | null {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  if (file.type) return null; // a real, but unsupported, type
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? null;
}

/** Friendly pre-check so students get quick feedback. The server repeats every check and is the real gate. */
export function validateCorFile(file: Pick<File, "name" | "type" | "size"> | null | undefined): string | null {
  if (!file || !file.name) return "Please attach your Certificate of Registration (COR).";
  if (file.size === 0) return "That file is empty. Please choose your COR again.";
  if (corContentType(file) === null) return "Please upload your COR as a PDF, JPG or PNG file.";
  if (file.size > COR_MAX_BYTES) return `That file is too large. Please upload a COR under ${COR_MAX_LABEL}.`;
  return null;
}

async function callFunction(name: string, idToken: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/${name}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // The functions only send short, user-safe messages.
    throw new Error(typeof body.error === "string" ? body.error : "Something went wrong. Please try again.");
  }
  return body;
}

/** Uploads the signed-in student's COR. Returns the stored path reported by the server. */
export async function uploadCor(idToken: string, file: File): Promise<string> {
  const invalid = validateCorFile(file);
  if (invalid) throw new Error(invalid);
  const form = new FormData();
  form.append("file", file);
  const body = await callFunction("submit-cor", idToken, { method: "POST", body: form });
  if (typeof body.path !== "string") throw new Error("The upload could not be confirmed. Please try again.");
  return body.path;
}

/** Removes the file of an unfinished signup. The server refuses once a profile exists. */
export async function deleteIncompleteCor(idToken: string): Promise<void> {
  await callFunction("submit-cor", idToken, { method: "DELETE" });
}

/** Short-lived (about 60 s) link to a COR. Allowed for its owner or the administrator. */
export async function requestCorUrl(idToken: string, studentUid: string): Promise<string> {
  const body = await callFunction("get-cor-url", idToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentUid }),
  });
  if (typeof body.url !== "string") throw new Error("Could not open that document.");
  return body.url;
}

/** Administrator only: asks the trusted backend to confirm the COR exists and is valid before approval. */
export async function confirmCorOnServer(idToken: string, studentUid: string): Promise<void> {
  await callFunction("verify-cor", idToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentUid }),
  });
}

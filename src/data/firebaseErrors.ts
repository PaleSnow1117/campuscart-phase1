// Turns Firebase errors into messages a student can act on. Kept free of any
// Firebase imports so it is easy to test. Raw SDK messages are never shown.

const MESSAGES: Record<string, string> = {
  "auth/email-already-in-use": "That email is already registered. Try logging in instead.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Please choose a stronger password (at least 6 characters).",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Can't reach the network. Check your connection and try again.",
  "auth/operation-not-allowed": "Email/password sign-in is not enabled for this Firebase project yet.",
  "auth/requires-recent-login": "Please log in again to do that.",
  "storage/unauthorized": "You don't have permission to upload that file.",
  "storage/unauthenticated": "Please log in again to upload your COR.",
  "storage/quota-exceeded": "File storage is full right now. Please try again later.",
  "storage/retry-limit-exceeded": "The upload took too long. Check your connection and try again.",
  "storage/canceled": "The upload was cancelled.",
  "permission-denied": "You don't have permission to do that.",
  "unavailable": "Can't reach the server. Check your connection and try again.",
  "unauthenticated": "Please log in again.",
  "not-found": "That item could not be found. It may have been removed.",
  "already-exists": "That already exists.",
  "invalid-argument": "That couldn't be saved. If you added photos, try fewer or smaller ones.",
  "resource-exhausted": "Too many requests right now. Please wait a moment and try again.",
  "deadline-exceeded": "The server took too long to respond. Please try again.",
  "failed-precondition": "That couldn't be completed right now. Please try again.",
  "cancelled": "The request was cancelled. Please try again.",
};

const GENERIC = "Something went wrong. Please try again.";

export function describeFirebaseError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  if (typeof code === "string") return MESSAGES[code] ?? GENERIC;
  if (error instanceof Error) return error.message || GENERIC; // our own readable messages
  return GENERIC;
}

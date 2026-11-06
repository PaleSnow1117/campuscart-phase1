import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase web config comes from Vite env vars (see .env.example). These values identify your project;
// they are not secrets, but they still belong in an untracked .env.local file. Access control is enforced
// by Firestore security rules and the Edge Functions, never by hiding this config.
//
// CORs are NOT stored in Firebase. They go to a private Supabase bucket through Edge Functions, so this
// app needs the public functions URL below but no Supabase key of any kind.

const env = import.meta.env as Record<string, string | undefined>;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** e.g. https://<project-ref>.supabase.co/functions/v1 (no trailing slash) */
export const functionsUrl = (env.VITE_SUPABASE_FUNCTIONS_URL ?? "").trim().replace(/\/+$/, "");

const REQUIRED = [config.apiKey, config.authDomain, config.projectId, config.appId, functionsUrl];

/** True only when every required VITE_* variable has a value. */
export const isFirebaseConfigured = REQUIRED.every((value) => typeof value === "string" && value.trim() !== "");

export class FirebaseNotConfiguredError extends Error {
  constructor() {
    super("Firebase is not configured. Add your VITE_* values to .env.local and restart the dev server.");
    this.name = "FirebaseNotConfiguredError";
  }
}

type Services = { app: FirebaseApp; auth: Auth; db: Firestore };
let services: Services | null = null;

/** Lazily initialises Firebase. Throws FirebaseNotConfiguredError if env vars are missing. */
export function getFirebase(): Services {
  if (!isFirebaseConfigured) throw new FirebaseNotConfiguredError();
  if (!services) {
    const app = getApps().length ? getApp() : initializeApp(config);
    services = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return services;
}

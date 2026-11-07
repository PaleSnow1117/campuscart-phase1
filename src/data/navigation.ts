// Back-navigation rules, kept pure (no React, no Capacitor) so they can be tested without a device.
// App.tsx stores a small marker in every history entry ({ idx, from }): how deep we are in the app's own history
// and which screen we came from. That is what lets "Back" know where it would go.

export type HistoryMark = { idx: number; from: string | null };

/** Reads the marker App.tsx writes into history.state. Anything unexpected counts as "start of the app's history". */
export function readHistoryMark(state: unknown): HistoryMark {
  if (typeof state === "object" && state !== null) {
    const { idx, from } = state as { idx?: unknown; from?: unknown };
    return { idx: typeof idx === "number" && idx > 0 ? idx : 0, from: typeof from === "string" ? from : null };
  }
  return { idx: 0, from: null };
}

export type BackAction = { type: "exit" } | { type: "history" } | { type: "navigate"; route: string };

/** The main marketplace screen (and the very first screen for visitors). Back here leaves the app. */
const ROOT_ROUTES = ["home", "welcome"];
const AUTH_ROUTES = ["welcome", "login", "signup"];

/** Where a screen "belongs", for when there is no in-app history to go back to (e.g. after a refresh on a deep screen). */
const PARENT_ROUTE: Record<string, string> = {
  product: "home", saved: "home", messages: "home", profile: "home", create: "home",
  chat: "messages",
  mylistings: "profile", campus: "profile", account: "profile", help: "profile", admin: "profile",
  edit: "mylistings",
  login: "welcome", signup: "welcome",
};

export function parentRoute(route: string): string {
  return PARENT_ROUTE[route] ?? "home";
}

export function decideBack(input: { route: string; signedIn: boolean; mark: HistoryMark }): BackAction {
  const { route, signedIn, mark } = input;
  if (ROOT_ROUTES.includes(route)) return { type: "exit" };
  if (mark.idx > 0 && mark.from) {
    // A signed-in student must never be sent back to the login / welcome screens (and never logged out by Back).
    if (signedIn && AUTH_ROUTES.includes(mark.from)) return { type: "navigate", route: "home" };
    return { type: "history" };
  }
  return { type: "navigate", route: parentRoute(route) };
}

// ---- transient screens (e.g. "editing a message") can claim the Back press first -------------------------

const interceptors: Array<() => boolean> = [];

/** Registers a handler that runs before normal back navigation. It returns true if it handled the press. */
export function registerBackInterceptor(handler: () => boolean): () => void {
  interceptors.push(handler);
  return () => {
    const at = interceptors.indexOf(handler);
    if (at >= 0) interceptors.splice(at, 1);
  };
}

/** Most recently registered first. Returns true when something handled the press. */
export function runBackInterceptors(): boolean {
  for (let i = interceptors.length - 1; i >= 0; i -= 1) {
    if (interceptors[i]()) return true;
  }
  return false;
}

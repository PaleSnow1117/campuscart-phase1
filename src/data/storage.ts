import type { User } from "./types";

export type LocalAccount = { user: User; password: string };

const ACCOUNTS_KEY = "campuscart.accounts";
const SESSION_KEY = "campuscart.session";

export function getAccounts(): LocalAccount[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(
      (entry): entry is LocalAccount =>
        typeof entry === "object" && entry !== null &&
        typeof entry.password === "string" &&
        typeof entry.user?.id === "string" &&
        typeof entry.user?.username === "string" &&
        typeof entry.user?.email === "string",
    ) : [];
  } catch {
    return [];
  }
}

export function saveAccounts(accounts: LocalAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function saveSessionId(id: string): void {
  localStorage.setItem(SESSION_KEY, id);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

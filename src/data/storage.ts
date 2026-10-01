import type { Listing, User } from "./types";

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

// ---- Phase 2: listings + saved items -------------------------------------

const LISTINGS_KEY = "campuscart.listings";
const SAVED_KEY = "campuscart.saved";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Returns null when nothing has ever been stored (so callers can seed). */
export function getStoredListings(): Listing[] | null {
  const value = readJson(LISTINGS_KEY);
  if (value === undefined || !Array.isArray(value)) return null;
  return value.filter(
    (entry): entry is Listing =>
      typeof entry === "object" && entry !== null &&
      typeof entry.id === "string" &&
      typeof entry.title === "string" &&
      typeof entry.price === "number" &&
      Array.isArray(entry.images),
  );
}

/** Throws if the browser refuses the write (e.g. storage quota exceeded). */
export function saveStoredListings(listings: Listing[]): void {
  localStorage.setItem(LISTINGS_KEY, JSON.stringify(listings));
}

function readSavedMap(): Record<string, string[]> {
  const value = readJson(SAVED_KEY);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const map: Record<string, string[]> = {};
  for (const [owner, ids] of Object.entries(value)) {
    if (Array.isArray(ids)) map[owner] = ids.filter((id): id is string => typeof id === "string");
  }
  return map;
}

export function getSavedIds(ownerId: string): string[] {
  return readSavedMap()[ownerId] ?? [];
}

export function saveSavedIds(ownerId: string, ids: string[]): void {
  localStorage.setItem(SAVED_KEY, JSON.stringify({ ...readSavedMap(), [ownerId]: ids }));
}

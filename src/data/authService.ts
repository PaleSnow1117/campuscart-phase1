import { clearSession, getAccounts, getSessionId, saveAccounts, saveSessionId } from "./storage";
import type { ProfileChanges, User } from "./types";

export type SignUpDetails = {
  fullName: string;
  username: string;
  email: string;
  password: string;
};

export const authService = {
  signUp({ fullName, username, email, password }: SignUpDetails): User {
    const name = fullName.trim();
    const handle = username.trim();
    const address = email.trim().toLowerCase();
    if (!name || !handle || !address || !password) {
      throw new Error("Please fill in all fields.");
    }
    const accounts = getAccounts();
    if (accounts.some(({ user }) => user.username.toLowerCase() === handle.toLowerCase())) {
      throw new Error("That username is already in use.");
    }
    if (accounts.some(({ user }) => user.email.toLowerCase() === address)) {
      throw new Error("That email is already in use.");
    }
    const user: User = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fullName: name,
      username: handle,
      email: address,
      campus: "URS Binangonan",
      createdAt: new Date().toISOString(),
    };
    saveAccounts([...accounts, { user, password }]);
    saveSessionId(user.id);
    return user;
  },

  login(username: string, password: string): User {
    if (!username.trim() || !password) throw new Error("Please enter your username and password.");
    const account = getAccounts().find(
      ({ user }) => user.username.toLowerCase() === username.trim().toLowerCase(),
    );
    if (!account || account.password !== password) {
      throw new Error("Invalid username or password.");
    }
    saveSessionId(account.user.id);
    return account.user;
  },

  getCurrentUser(): User | null {
    const id = getSessionId();
    return id ? getAccounts().find(({ user }) => user.id === id)?.user ?? null : null;
  },

  /** Edits profile fields on the stored account. The password is never touched. */
  updateProfile(userId: string, changes: ProfileChanges): User {
    const accounts = getAccounts();
    const account = accounts.find(({ user }) => user.id === userId);
    if (!account) throw new Error("Please log in again.");
    const next: User = { ...account.user };
    if (changes.fullName !== undefined) {
      next.fullName = changes.fullName.trim();
      if (!next.fullName) throw new Error("Please enter your full name.");
    }
    if (changes.username !== undefined) {
      next.username = changes.username.trim();
      if (!next.username) throw new Error("Please enter a username.");
      if (accounts.some(({ user }) => user.id !== userId && user.username.toLowerCase() === next.username.toLowerCase())) {
        throw new Error("That username is already in use.");
      }
    }
    if (changes.email !== undefined) {
      next.email = changes.email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(next.email)) throw new Error("Please enter a valid email address.");
      if (accounts.some(({ user }) => user.id !== userId && user.email.toLowerCase() === next.email)) {
        throw new Error("That email is already in use.");
      }
    }
    if (changes.campus !== undefined) {
      next.campus = changes.campus.trim();
      if (!next.campus) throw new Error("Please choose a campus.");
    }
    saveAccounts(accounts.map((entry) => (entry.user.id === userId ? { ...entry, user: next } : entry)));
    return next;
  },

  logout(): void {
    clearSession();
  },
};
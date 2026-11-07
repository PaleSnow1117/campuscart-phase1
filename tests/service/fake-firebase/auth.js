// A small in-memory Firebase Auth. NOT the real SDK. It models what matters for session handling: accounts,
// a "persisted" current user that survives page reloads, and listeners that fire like onAuthStateChanged.
const A = (globalThis.__auth ??= { accounts: new Map(), current: null, listeners: new Set(), log: [] });
const err = (code) => Object.assign(new Error(code), { code });
const toUser = (rec) => ({ uid: rec.uid, email: rec.email, getIdToken: async (force) => { if (force) A.log.push("getIdToken(true)"); return `tok-${rec.uid}`; } });
const notify = () => { const u = A.current; queueMicrotask(() => [...A.listeners].forEach((l) => l(u))); };
export const getAuth = () => ({ get currentUser() { return A.current; } });
export async function createUserWithEmailAndPassword(_a, email, password) {
  A.log.push("create"); if (A.accounts.has(email)) throw err("auth/email-already-in-use");
  const rec = { uid: "uid" + (A.accounts.size + 1), email, password }; A.accounts.set(email, rec); A.current = toUser(rec); notify(); return { user: A.current };
}
export async function signInWithEmailAndPassword(_a, email, password) {
  A.log.push("signIn"); const rec = A.accounts.get(email); if (!rec || rec.password !== password) throw err("auth/invalid-credential");
  A.current = toUser(rec); notify(); return { user: A.current };
}
export async function signOut() { A.log.push("signOut"); A.current = null; notify(); }
export async function deleteUser(u) { A.log.push("deleteUser"); for (const [e, r] of A.accounts) if (r.uid === u.uid) A.accounts.delete(e); A.current = null; notify(); }
export function onAuthStateChanged(_a, cb) { A.listeners.add(cb); queueMicrotask(() => cb(A.current)); return () => { A.listeners.delete(cb); }; }
// Re-authentication and "verify before update e-mail". Like the real thing, verifyBeforeUpdateEmail only SENDS a link:
// the account's e-mail does not change until the person opens it (tests simulate that by editing the account).
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function reauthenticateWithCredential(user, credential) {
  A.log.push("reauth"); const rec = A.accounts.get(user.email);
  if (!rec || rec.password !== credential.password || credential.email !== user.email) throw err("auth/invalid-credential");
}
export async function verifyBeforeUpdateEmail(user, newEmail) {
  A.log.push(`verifyBeforeUpdateEmail:${newEmail}`); if (A.accounts.has(newEmail)) throw err("auth/email-already-in-use");
  A.sentLinks = [...(A.sentLinks ?? []), { uid: user.uid, newEmail }];
}

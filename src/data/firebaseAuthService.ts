import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDocFromServer, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { deleteIncompleteCor, uploadCor, validateCorFile } from "./corService";
import { getFirebase } from "./firebase";
import { DEFAULT_CAMPUS, type ProfileChanges, type User, type VerificationStatus } from "./types";

// Firebase-backed accounts (Phase 4A). Used instead of the local authService
// when Firebase is configured. Firestore document users/{uid} holds the
// profile; the password lives only in Firebase Auth and is never stored or
// returned here. Verification fields are written as "pending" on signup and can
// only be changed by an administrator (enforced by firestore.rules, not here).

export type FirebaseSignUpDetails = {
  fullName: string;
  username: string;
  studentNumber: string;
  email: string;
  password: string;
  corFile: File | null;
};

const STATUSES: VerificationStatus[] = ["pending", "approved", "rejected"];

function toIso(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" ? value : null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Builds a User from the stored profile. A missing or unclear status is treated as "pending" (never approved). */
function toUser(uid: string, data: Record<string, unknown> | undefined, fallbackEmail: string): User {
  const status = STATUSES.find((entry) => entry === data?.verificationStatus) ?? "pending";
  return {
    id: uid,
    fullName: text(data?.fullName) || fallbackEmail.split("@")[0] || "Student",
    username: text(data?.username) || fallbackEmail.split("@")[0] || "student",
    email: text(data?.email) || fallbackEmail,
    campus: text(data?.campus) || DEFAULT_CAMPUS,
    createdAt: toIso(data?.createdAt) ?? new Date().toISOString(),
    studentNumber: text(data?.studentNumber) || undefined,
    verificationStatus: status,
    corStoragePath: typeof data?.corStoragePath === "string" ? data.corStoragePath : null,
    verifiedAt: toIso(data?.verifiedAt),
    reviewedAt: toIso(data?.reviewedAt),
  };
}

/**
 * Reads the profile from the SERVER (never the cache). Returns null only when the server confirms there is
 * no profile, i.e. an unfinished registration. Network or permission problems throw instead, so a bad
 * connection is never mistaken for a missing profile.
 */
async function loadUser(firebaseUser: FirebaseUser): Promise<User | null> {
  const snapshot = await getDocFromServer(doc(getFirebase().db, "users", firebaseUser.uid));
  return snapshot.exists() ? toUser(firebaseUser.uid, snapshot.data(), firebaseUser.email ?? "") : null;
}

export const INCOMPLETE_MESSAGE = "Your registration wasn't completed. Please sign up again with the same email and password to finish.";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

// ---- auth state ----------------------------------------------------------

type Listener = (user: User | null) => void;
const listeners = new Set<Listener>();
let attached = false;
let ready = false;
let current: User | null = null;
let signingUp = false; // hold back auth events until the profile document exists

function emit(user: User | null): void {
  ready = true;
  current = user;
  listeners.forEach((listener) => listener(user));
}

function attach(): void {
  if (attached) return;
  attached = true;
  onAuthStateChanged(getFirebase().auth, (firebaseUser) => {
    if (signingUp) return;
    if (!firebaseUser) { emit(null); return; }
    loadUser(firebaseUser).then(
      (user) => {
        // No profile on the server = an unfinished signup. Never treat it as a usable (or pending) account.
        if (!user) signOut(getFirebase().auth).catch(() => undefined);
        emit(user);
      },
      () => emit(null),
    );
  });
}

function validStudentNumber(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ./_-]{1,28}[A-Za-z0-9]$/.test(value);
}

export const firebaseAuthService = {
  /** Calls back with the signed-in user (or null) now and whenever it changes. Returns an unsubscribe. */
  onAuthChange(listener: Listener): () => void {
    listeners.add(listener);
    attach();
    if (ready) listener(current);
    return () => { listeners.delete(listener); };
  },

  async signUp({ fullName, username, studentNumber, email, password, corFile }: FirebaseSignUpDetails): Promise<User> {
    const name = fullName.trim();
    const handle = username.trim();
    const number = studentNumber.trim();
    const address = email.trim().toLowerCase();
    if (!name || !handle || !number || !address || !password) throw new Error("Please fill in all fields.");
    // Basic sanity check only. A student number does not prove enrollment; the COR does.
    if (!validStudentNumber(number)) throw new Error("Please enter a valid student number.");
    const corProblem = validateCorFile(corFile);
    if (corProblem || !corFile) throw new Error(corProblem ?? "Please attach your Certificate of Registration (COR).");

    const { auth, db } = getFirebase();
    signingUp = true;
    let result: User | null = null;
    try {
      let created: FirebaseUser;
      try {
        created = (await createUserWithEmailAndPassword(auth, address, password)).user;
      } catch (failure) {
        if (errorCode(failure) !== "auth/email-already-in-use") throw failure;
        // Possibly an abandoned signup (account created, profile never saved). Sign in with the same
        // credentials; if there is no profile we can finish the registration, otherwise it's a real account.
        try {
          created = (await signInWithEmailAndPassword(auth, address, password)).user;
        } catch {
          throw failure; // wrong password etc.: just report that the email is taken
        }
        const existing = await getDocFromServer(doc(db, "users", created.uid)).catch(() => null);
        if (!existing || existing.exists()) {
          await signOut(auth).catch(() => undefined);
          throw failure;
        }
      }
      try {
        const corPath = await uploadCor(await created.getIdToken(), corFile);
        await setDoc(doc(db, "users", created.uid), {
          fullName: name,
          username: handle,
          email: address,
          studentNumber: number,
          campus: DEFAULT_CAMPUS,
          verificationStatus: "pending",
          corStoragePath: corPath,
          createdAt: serverTimestamp(),
          verifiedAt: null,
        });
        result = await loadUser(created);
        if (!result) throw new Error("We couldn't confirm your registration. Please try again.");
      } catch (failure) {
        // Undo as much as possible so the student can retry cleanly. Each step is best effort; anything left
        // behind is an unfinished signup that "sign up again with the same email" resumes (see above).
        const idToken = await created.getIdToken().catch(() => null);
        if (idToken) await deleteIncompleteCor(idToken).catch(() => undefined);
        await deleteUser(created).catch(() => signOut(auth).catch(() => undefined));
        throw failure;
      }
    } finally {
      signingUp = false;
      emit(result);
    }
    return result;
  },

  async login(email: string, password: string): Promise<User> {
    if (!email.trim() || !password) throw new Error("Please enter your email and password.");
    const { auth } = getFirebase();
    const { user } = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    let profile: User | null;
    try {
      profile = await loadUser(user);
    } catch (failure) {
      await signOut(auth).catch(() => undefined); // don't leave a half signed-in session behind
      throw failure;
    }
    if (!profile) {
      await signOut(auth).catch(() => undefined);
      throw new Error(INCOMPLETE_MESSAGE);
    }
    return profile;
  },

  /** A fresh Firebase ID token for calling the Edge Functions. */
  async getIdToken(): Promise<string> {
    const current = getFirebase().auth.currentUser;
    if (!current) throw new Error("Please log in again.");
    return current.getIdToken();
  },

  /** Re-reads the profile, e.g. to pick up an administrator's decision. */
  async refreshCurrentUser(): Promise<User | null> {
    const firebaseUser = getFirebase().auth.currentUser;
    if (!firebaseUser) return null;
    const user = await loadUser(firebaseUser);
    emit(user);
    return user;
  },

  /** Name, username and campus only. Verification fields and email are not editable here. */
  async updateProfile(user: User, changes: ProfileChanges): Promise<User> {
    const update: { fullName?: string; username?: string; campus?: string } = {};
    if (changes.fullName !== undefined) {
      update.fullName = changes.fullName.trim();
      if (!update.fullName) throw new Error("Please enter your full name.");
    }
    if (changes.username !== undefined) {
      update.username = changes.username.trim();
      if (!update.username) throw new Error("Please enter a username.");
    }
    if (changes.campus !== undefined) {
      update.campus = changes.campus.trim();
      if (!update.campus) throw new Error("Please choose a campus.");
    }
    if (Object.keys(update).length) await updateDoc(doc(getFirebase().db, "users", user.id), update);
    const updated = { ...user, ...update };
    emit(updated);
    return updated;
  },

  async logout(): Promise<void> {
    await signOut(getFirebase().auth);
  },
};

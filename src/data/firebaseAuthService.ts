import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  verifyBeforeUpdateEmail,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDocFromServer, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { avatarStoragePath, deleteAvatar, uploadAvatar } from "./avatarService";
import { deleteIncompleteCor, resubmitCor as sendCorResubmission, uploadCor, validateCorFile } from "./corService";
import { getFirebase } from "./firebase";
import { describeFirebaseError } from "./firebaseErrors";
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
    photoPath: typeof data?.photoPath === "string" && data.photoPath ? data.photoPath : null,
    photoUpdatedAt: toIso(data?.photoUpdatedAt),
  };
}

/**
 * Reads the profile from the SERVER (never the cache). Resolves null only when the server confirms there is
 * no profile, i.e. an unfinished registration. Network or permission problems reject instead, so a bad
 * connection is never mistaken for a missing profile.
 */
async function loadUser(firebaseUser: FirebaseUser): Promise<User | null> {
  const ref = doc(getFirebase().db, "users", firebaseUser.uid);
  const snapshot = await getDocFromServer(ref);
  if (!snapshot.exists()) return null;
  const user = toUser(firebaseUser.uid, snapshot.data(), firebaseUser.email ?? "");
  // The sign-in e-mail is the one Firebase Authentication holds. After a verified e-mail change (the person opened the
  // link we sent) the profile's copy is stale, so show the real one and bring the profile in step. The rules only accept
  // exactly the VERIFIED Auth e-mail here. Best effort: if it fails it is simply retried the next time the profile loads.
  const authEmail = (firebaseUser.email ?? "").toLowerCase();
  if (authEmail && authEmail !== user.email.toLowerCase()) {
    user.email = authEmail;
    try {
      await firebaseUser.getIdToken(true);
      await updateDoc(ref, { email: authEmail });
    } catch {
      // not fatal
    }
  }
  return user;
}

export const INCOMPLETE_MESSAGE = "Your registration wasn't completed. Please sign up again with the same email and password to finish.";
const UNAVAILABLE_MESSAGE = "You're signed in, but we can't reach CampusCart right now. We'll keep trying.";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

// ---- auth state ------------------------------------------------------------------------------------------
//
// Firebase Auth keeps the signed-in session (persisted in the browser) across refreshes and across short
// outages by itself. Our job is only to load the student's profile on top of it. The states are:
//   initializing  Firebase has not reported yet, or the first profile read is still running
//   signedOut     nobody is signed in (or the server confirmed the registration was never completed)
//   ready         signed in and the profile was read from the server
//   unavailable   signed in, but the profile could NOT be read (offline, timeout, permission...). The session is
//                 kept, nothing marketplace-related is unlocked, and the read is retried until it works.
// A failed profile read is NEVER treated as "signed out", and it never signs anybody out.

export type AuthState =
  | { status: "initializing" }
  | { status: "signedOut" }
  | { status: "ready"; user: User }
  | { status: "unavailable"; error: string; retrying: boolean };

/** Exposed so tests can shorten the waits. */
export const authTimings = {
  /** A profile read that has not answered after this long counts as unavailable (never an endless spinner). */
  profileTimeoutMs: 8_000,
  /** Waits between automatic retries; the last value repeats. Going back online retries immediately. */
  retryDelaysMs: [3_000, 6_000, 12_000, 24_000, 30_000],
};

type Outcome =
  | { kind: "ok"; user: User }
  | { kind: "missing" }
  | { kind: "unavailable"; error: unknown };

type Listener = (state: AuthState) => void;
const listeners = new Set<Listener>();
let attached = false;
let state: AuthState = { status: "initializing" };
let signingUp = false; // hold back auth events until a new registration is complete
// Bumped on every auth event, retry, sign-up and logout. A profile answer is applied only if it is still the
// newest one, so a slow, stale answer can never overwrite a newer state (or resurrect a logged-out user).
let generation = 0;
let inflight: { uid: string; gen: number; promise: Promise<Outcome> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function publish(next: AuthState): void {
  state = next;
  listeners.forEach((listener) => listener(next));
}

function cancelRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** Forget everything in flight (new sign-in, logout, sign-up...). */
function supersede(): void {
  generation += 1;
  inflight = null;
  cancelRetry();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("Timed out loading the profile."), { code: "unavailable" })), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (failure) => { clearTimeout(timer); reject(failure); },
    );
  });
}

/** User-safe text for why the profile could not be read. */
function unavailableMessage(error: unknown): string {
  const code = errorCode(error);
  const connectivity = code === "unavailable" || code === "deadline-exceeded" || code === "auth/network-request-failed";
  return connectivity ? describeFirebaseError(error) : "We couldn't load your profile right now.";
}

async function readProfile(firebaseUser: FirebaseUser): Promise<Outcome> {
  try {
    const user = await withTimeout(loadUser(firebaseUser), authTimings.profileTimeoutMs);
    return user ? { kind: "ok", user } : { kind: "missing" };
  } catch (error) {
    // Only the error CODE is logged (no tokens, no personal data) so a failure can be diagnosed.
    console.warn(`[CampusCart auth] profile not available (${errorCode(error) ?? "unknown"}); the session is kept and loading will retry.`);
    return { kind: "unavailable", error };
  }
}

/** Applies a profile answer, but only if it is still the newest one for the account that is signed in now. */
function apply(outcome: Outcome, firebaseUser: FirebaseUser, gen: number): void {
  if (gen !== generation) return;
  const { auth } = getFirebase();
  if (auth.currentUser?.uid !== firebaseUser.uid) return;
  if (outcome.kind === "ok") {
    retryAttempt = 0;
    cancelRetry();
    publish({ status: "ready", user: outcome.user });
  } else if (outcome.kind === "missing") {
    // The SERVER confirmed there is no profile: an unfinished registration. Safe to sign out; signing up again resumes it.
    retryAttempt = 0;
    cancelRetry();
    signOut(auth).catch(() => undefined);
    publish({ status: "signedOut" });
  } else {
    publish({ status: "unavailable", error: unavailableMessage(outcome.error), retrying: false });
    scheduleRetry(gen);
  }
}

/** Starts (or joins) the profile read for the signed-in account and applies the answer. */
function settle(firebaseUser: FirebaseUser, force = false): Promise<Outcome> {
  if (!force && inflight && inflight.uid === firebaseUser.uid && inflight.gen === generation) return inflight.promise;
  generation += 1;
  cancelRetry();
  const gen = generation;
  const promise = readProfile(firebaseUser).then((outcome) => {
    if (inflight?.gen === gen) inflight = null;
    apply(outcome, firebaseUser, gen);
    return outcome;
  });
  inflight = { uid: firebaseUser.uid, gen, promise };
  return promise;
}

function scheduleRetry(gen: number): void {
  cancelRetry();
  const delays = authTimings.retryDelaysMs;
  const delay = delays[Math.min(retryAttempt, delays.length - 1)];
  retryAttempt += 1;
  retryTimer = setTimeout(() => { retryTimer = null; void retryNow(gen); }, delay);
}

async function retryNow(expectedGen?: number): Promise<void> {
  if (state.status !== "unavailable") return;
  if (expectedGen !== undefined && expectedGen !== generation) return;
  const firebaseUser = getFirebase().auth.currentUser;
  if (!firebaseUser) {
    supersede();
    publish({ status: "signedOut" });
    return;
  }
  publish({ status: "unavailable", error: state.error, retrying: true });
  await settle(firebaseUser, true);
}

function attach(): void {
  if (attached) return;
  attached = true;
  onAuthStateChanged(getFirebase().auth, (firebaseUser) => {
    if (signingUp) return;
    if (!firebaseUser) {
      supersede();
      retryAttempt = 0;
      publish({ status: "signedOut" });
      return;
    }
    void settle(firebaseUser);
  });
  // Coming back online retries straight away instead of waiting for the next timer.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => {
      if (state.status === "unavailable") {
        retryAttempt = 0;
        void retryNow();
      }
    });
  }
}

export function validStudentNumber(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 ./_-]{1,28}[A-Za-z0-9]$/.test(value);
}

export const firebaseAuthService = {
  /** Calls back with the current auth state now (once Firebase has reported) and on every change. Returns an unsubscribe. */
  onAuthChange(listener: Listener): () => void {
    listeners.add(listener);
    attach();
    if (state.status !== "initializing") listener(state);
    return () => { listeners.delete(listener); };
  },

  /** "Try again" on the reconnect screen. */
  async retryProfile(): Promise<void> {
    retryAttempt = 0;
    await retryNow();
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
    supersede();
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
        let existing;
        try {
          existing = await getDocFromServer(doc(db, "users", created.uid));
        } catch (readFailure) {
          await signOut(auth).catch(() => undefined);
          throw readFailure; // e.g. offline: report THAT, not a misleading "email already in use"
        }
        if (existing.exists()) {
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
        // We just wrote this profile as "pending", so build the user from it instead of reading it back: a failed
        // read-back after a successful write must not undo a registration that actually completed.
        result = toUser(created.uid, { fullName: name, username: handle, email: address, studentNumber: number, campus: DEFAULT_CAMPUS, verificationStatus: "pending", corStoragePath: corPath, verifiedAt: null }, address);
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
      supersede();
      publish(result ? { status: "ready", user: result } : { status: "signedOut" });
    }
    return result;
  },

  async login(email: string, password: string): Promise<User> {
    if (!email.trim() || !password) throw new Error("Please enter your email and password.");
    const { auth } = getFirebase();
    const { user } = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    // Shares the profile read with the auth listener, so there is one read and one answer.
    const outcome = await settle(user);
    if (outcome.kind === "ok") return outcome.user;
    if (outcome.kind === "missing") {
      await signOut(auth).catch(() => undefined);
      throw new Error(INCOMPLETE_MESSAGE);
    }
    // The password was right and the session is valid, so we do NOT sign out. The app now shows the reconnect
    // screen and finishes loading by itself as soon as the profile can be read.
    throw new Error(UNAVAILABLE_MESSAGE);
  },

  /**
   * A rejected student uploads a corrected COR. The Edge Function replaces the file and only then reopens the request
   * as "pending" (never a client write), then the profile is read again so the app shows the new status.
   */
  async resubmitCor(file: File | null): Promise<User> {
    const problem = validateCorFile(file);
    if (problem || !file) throw new Error(problem ?? "Please attach your corrected Certificate of Registration (COR).");
    const current = getFirebase().auth.currentUser;
    if (!current) throw new Error("Please log in again.");
    await sendCorResubmission(await current.getIdToken(), file);
    const user = await firebaseAuthService.refreshCurrentUser();
    if (!user) throw new Error("Your corrected COR was submitted, but we couldn't refresh your status. Please check again in a moment.");
    return user;
  },

  /** A fresh Firebase ID token for calling the Edge Functions. */
  async getIdToken(): Promise<string> {
    const current = getFirebase().auth.currentUser;
    if (!current) throw new Error("Please log in again.");
    return current.getIdToken();
  },

  /**
   * Re-reads the profile, e.g. to pick up an administrator's decision. A failed read changes NOTHING (the person
   * stays signed in with what they already had); it never flips the app to the reconnect screen.
   */
  async refreshCurrentUser(): Promise<User | null> {
    const firebaseUser = getFirebase().auth.currentUser;
    if (!firebaseUser) return null;
    const gen = generation; // not bumped: a refresh must not cancel a pending reconnect retry, and a newer event still wins
    const outcome = await readProfile(firebaseUser);
    if (outcome.kind === "ok" || outcome.kind === "missing") apply(outcome, firebaseUser, gen);
    return outcome.kind === "ok" ? outcome.user : state.status === "ready" ? state.user : null;
  },

  /**
   * Name, username and campus only (verification fields, student number and e-mail are not editable here).
   * Only values that actually changed are validated and written, and nothing here touches verification status.
   */
  async updateProfile(user: User, changes: ProfileChanges): Promise<User> {
    const update: { fullName?: string; username?: string; campus?: string } = {};
    if (changes.fullName !== undefined && changes.fullName.trim() !== user.fullName) {
      const fullName = changes.fullName.trim();
      if (!fullName) throw new Error("Please enter your full name.");
      if (fullName.length < 2 || fullName.length > 100) throw new Error("Your full name must be 2 to 100 characters.");
      update.fullName = fullName;
    }
    if (changes.username !== undefined && changes.username.trim() !== user.username) {
      const username = changes.username.trim();
      if (!username) throw new Error("Please enter a username.");
      if (username.length < 3 || username.length > 50 || /\s/.test(username)) throw new Error("Usernames are 3 to 50 characters with no spaces.");
      update.username = username;
    }
    if (changes.campus !== undefined && changes.campus.trim() !== user.campus) {
      const campus = changes.campus.trim();
      if (!campus) throw new Error("Please choose a campus.");
      update.campus = campus;
    }
    if (!Object.keys(update).length) return user;
    await updateDoc(doc(getFirebase().db, "users", user.id), update);
    const updated = { ...user, ...update };
    publish({ status: "ready", user: updated });
    return updated;
  },

  /**
   * Sets or replaces the signed-in student's profile picture. `image` is the already-prepared (cropped, shrunk) picture.
   * The Edge Function stores it at {uid}/avatar, with the uid taken from the verified token. Only after that succeeded
   * does the profile record the path; the rules accept nothing but the student's own path.
   */
  async updateProfilePhoto(user: User, image: Blob): Promise<User> {
    const { auth, db } = getFirebase();
    const current = auth.currentUser;
    if (!current || current.uid !== user.id) throw new Error("Please log in again.");
    const path = await uploadAvatar(await current.getIdToken(), image);
    if (path !== avatarStoragePath(user.id)) throw new Error("The upload could not be confirmed. Please try again.");
    await updateDoc(doc(db, "users", user.id), { photoPath: path, photoUpdatedAt: serverTimestamp() });
    const updated: User = { ...user, photoPath: path, photoUpdatedAt: new Date().toISOString() };
    publish({ status: "ready", user: updated });
    return updated;
  },

  /**
   * Removes the profile picture. The stored file goes first: if that fails nothing changes. Removing a file that is
   * already gone is fine, so a retry after a failed profile update simply finishes the job.
   */
  async removeProfilePhoto(user: User): Promise<User> {
    const { auth, db } = getFirebase();
    const current = auth.currentUser;
    if (!current || current.uid !== user.id) throw new Error("Please log in again.");
    await deleteAvatar(await current.getIdToken());
    await updateDoc(doc(db, "users", user.id), { photoPath: null, photoUpdatedAt: null });
    const updated: User = { ...user, photoPath: null, photoUpdatedAt: null };
    publish({ status: "ready", user: updated });
    return updated;
  },

  /**
   * Starts a sign-in e-mail change the way Firebase Authentication supports it: the password is checked again, then a
   * verification link is sent to the NEW address. The e-mail only changes after the link is opened. The profile copy
   * follows automatically the next time the profile loads (see loadUser).
   */
  async requestEmailChange(newEmail: string, password: string): Promise<void> {
    const email = newEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Please enter a valid email address.");
    if (!password) throw new Error("Please enter your current password.");
    const current = getFirebase().auth.currentUser;
    if (!current || !current.email) throw new Error("Please log in again.");
    if (email === current.email.toLowerCase()) throw new Error("That is already your email address.");
    await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
    await verifyBeforeUpdateEmail(current, email);
  },

  /** Explicit logout: forgets everything in flight and any pending retry, then signs out. */
  async logout(): Promise<void> {
    supersede();
    retryAttempt = 0;
    try {
      await signOut(getFirebase().auth);
    } finally {
      publish({ status: "signedOut" });
    }
  },
};

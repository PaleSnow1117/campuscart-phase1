import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebase } from "./firebase";
import { validStudentNumber } from "./firebaseAuthService";
import type { User } from "./types";

// A student number is identity data tied to the student's COR, so it is NOT editable directly. A student sends a
// change REQUEST (studentNumberRequests/{uid}); an administrator reviews it (checking the COR) and, if approved,
// the administrator's approval and the profile change happen in one write. Verification status never changes.

export type StudentNumberRequest = {
  uid: string;
  requestedNumber: string;
  currentNumber: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string | null;
  reviewedAt: string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const iso = (value: unknown): string | null =>
  typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export function toStudentNumberRequest(uid: string, data: Record<string, unknown> | undefined): StudentNumberRequest | null {
  if (!data) return null;
  const status = data.status === "approved" || data.status === "rejected" ? data.status : data.status === "pending" ? "pending" : null;
  if (!status || typeof data.requestedNumber !== "string") return null;
  return { uid, requestedNumber: data.requestedNumber, currentNumber: text(data.currentNumber), status, requestedAt: iso(data.requestedAt), reviewedAt: iso(data.reviewedAt) };
}

export const studentNumberService = {
  /** The student's latest change request, or null if they never made one. */
  async get(uid: string): Promise<StudentNumberRequest | null> {
    const snapshot = await getDoc(doc(getFirebase().db, "studentNumberRequests", uid));
    return snapshot.exists() ? toStudentNumberRequest(uid, snapshot.data()) : null;
  },

  /** Sends (or replaces) the student's change request. It always starts as "pending"; only an administrator can decide it. */
  async request(user: User, rawNumber: string): Promise<void> {
    const requestedNumber = rawNumber.trim();
    if (!validStudentNumber(requestedNumber)) throw new Error("Please enter a valid student number.");
    if (requestedNumber === (user.studentNumber ?? "")) throw new Error("That is already your student number.");
    await setDoc(doc(getFirebase().db, "studentNumberRequests", user.id), {
      requestedNumber,
      currentNumber: user.studentNumber ?? "",
      status: "pending",
      requestedAt: serverTimestamp(),
      reviewedAt: null,
    });
  },
};

import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { confirmCorOnServer, requestCorUrl } from "./corService";
import { getFirebase } from "./firebase";
import { firebaseAuthService } from "./firebaseAuthService";
import { toStudentNumberRequest, type StudentNumberRequest } from "./studentNumberService";

// Administrator actions. NOTHING here grants power: every call is checked again on the server side.
//  - Firestore rules decide who may list users and change verification fields (only a Console-created
//    admins/{uid} record qualifies).
//  - The Edge Functions repeat the admin check and the COR existence check.
// The app uses isAdmin() only to decide whether to SHOW the admin screen.

/** A pending student-number change request, with the student's name and e-mail so it can be reviewed. */
export type StudentNumberReview = StudentNumberRequest & { fullName: string; email: string };

export type PendingStudent = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  studentNumber: string;
  campus: string;
  createdAt: string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const iso = (value: unknown): string | null =>
  typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate().toISOString()
    : null;

export const adminService = {
  /** Convenience for the UI. A normal user simply gets "not found" (the rules allow reading only your own admins doc). */
  async isAdmin(uid: string): Promise<boolean> {
    try {
      return (await getDoc(doc(getFirebase().db, "admins", uid))).exists();
    } catch {
      return false;
    }
  },

  async listPending(): Promise<PendingStudent[]> {
    const snapshot = await getDocs(query(collection(getFirebase().db, "users"), where("verificationStatus", "==", "pending")));
    return snapshot.docs
      .map((entry) => {
        const data = entry.data();
        return {
          id: entry.id,
          fullName: text(data.fullName),
          username: text(data.username),
          email: text(data.email),
          studentNumber: text(data.studentNumber),
          campus: text(data.campus),
          createdAt: iso(data.createdAt),
        };
      })
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  },

  /** A ~60 second signed link to the student's COR. */
  async getCorUrl(studentUid: string): Promise<string> {
    return requestCorUrl(await firebaseAuthService.getIdToken(), studentUid);
  },

  /**
   * Step 1: the trusted backend confirms the COR exists and is valid and records corVerifiedAt.
   * Step 2: the decision is written. The rules refuse "approved" unless step 1 has happened.
   */
  async approve(studentUid: string): Promise<void> {
    await confirmCorOnServer(await firebaseAuthService.getIdToken(), studentUid);
    await updateDoc(doc(getFirebase().db, "users", studentUid), {
      verificationStatus: "approved",
      verifiedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
    });
  },

  /** Pending student-number change requests, oldest first. */
  async listStudentNumberRequests(): Promise<StudentNumberReview[]> {
    const { db } = getFirebase();
    const snapshot = await getDocs(query(collection(db, "studentNumberRequests"), where("status", "==", "pending")));
    const requests = snapshot.docs
      .map((entry) => toStudentNumberRequest(entry.id, entry.data()))
      .filter((entry): entry is StudentNumberRequest => entry !== null)
      .sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));
    return Promise.all(requests.map(async (request) => {
      const profile = (await getDoc(doc(db, "users", request.uid))).data();
      return { ...request, fullName: text(profile?.fullName), email: text(profile?.email) };
    }));
  },

  /**
   * Approving changes the student's number AND marks the request approved in ONE write (the rules refuse one without
   * the other). Rejecting only closes the request. Neither touches verification status.
   */
  async reviewStudentNumber(studentUid: string, approve: boolean): Promise<void> {
    const { db } = getFirebase();
    const requestRef = doc(db, "studentNumberRequests", studentUid);
    const batch = writeBatch(db);
    if (approve) {
      const request = toStudentNumberRequest(studentUid, (await getDoc(requestRef)).data());
      if (!request || request.status !== "pending") throw new Error("That request is no longer pending.");
      batch.update(requestRef, { status: "approved", reviewedAt: serverTimestamp() });
      batch.update(doc(db, "users", studentUid), { studentNumber: request.requestedNumber });
    } else {
      batch.update(requestRef, { status: "rejected", reviewedAt: serverTimestamp() });
    }
    await batch.commit();
  },

  async reject(studentUid: string): Promise<void> {
    await updateDoc(doc(getFirebase().db, "users", studentUid), {
      verificationStatus: "rejected",
      verifiedAt: null,
      reviewedAt: serverTimestamp(),
    });
  },
};

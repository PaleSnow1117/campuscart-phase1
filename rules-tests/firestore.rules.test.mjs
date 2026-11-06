// Firestore rules tests for CampusCart (Phase 4B).
// NOT RUN by the author (needs the Firebase emulator + Java). Run them yourself:
//   npm.cmd install -D @firebase/rules-unit-testing        (dev-only, optional)
//   npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs"
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-campuscart",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
});
const baseProfile = (uid) => ({ fullName: "Ana Reyes", username: "ana", email: `${uid}@urs.edu.ph`, studentNumber: "2021-00123", campus: "URS Binangonan",
  verificationStatus: "pending", corStoragePath: `${uid}/cor`, createdAt: Timestamp.now(), verifiedAt: null });
const reseed = async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "admins/ADMIN"), { note: "owner" });
    await setDoc(doc(db, "attestors/ATT"), { note: "backend" });
    await setDoc(doc(db, "users/A"), baseProfile("A"));
    await setDoc(doc(db, "users/B"), baseProfile("B"));
    await setDoc(doc(db, "users/V"), { ...baseProfile("V"), corVerifiedAt: Timestamp.now() });
  });
};
const as = (uid, email) => env.authenticatedContext(uid, { email: email ?? `${uid}@urs.edu.ph` }).firestore();
let failed = 0;
const test = async (name, fn) => { await reseed(); try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };

// ---- reads
await test("signed-out cannot read a profile", () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users/A"))));
await test("student reads own profile", () => assertSucceeds(getDoc(doc(as("A"), "users/A"))));
await test("student cannot read another profile", () => assertFails(getDoc(doc(as("A"), "users/B"))));
await test("student cannot list/query users", () => assertFails(getDocs(collection(as("A"), "users"))));
await test("admin reads any profile and lists users", async () => { await assertSucceeds(getDoc(doc(as("ADMIN"), "users/B"))); await assertSucceeds(getDocs(collection(as("ADMIN"), "users"))); });
// ---- admins / attestors collections
await test("anyone can read ONLY their own admins doc", async () => { await assertSucceeds(getDoc(doc(as("A"), "admins/A"))); await assertFails(getDoc(doc(as("A"), "admins/ADMIN"))); await assertSucceeds(getDoc(doc(as("ADMIN"), "admins/ADMIN"))); });
await test("nobody can list admins", () => assertFails(getDocs(collection(as("ADMIN"), "admins"))));
await test("no client can create/update/delete admins (student, admin, attestor)", async () => { for (const uid of ["A", "ADMIN", "ATT"]) { await assertFails(setDoc(doc(as(uid), "admins/A"), { x: 1 })); await assertFails(setDoc(doc(as(uid), "admins/ADMIN"), { x: 2 })); await assertFails(deleteDoc(doc(as(uid), "admins/ADMIN"))); } });
await test("no client can touch attestors", async () => { await assertFails(getDoc(doc(as("ATT"), "attestors/ATT"))); await assertFails(setDoc(doc(as("A"), "attestors/A"), { x: 1 })); });
// ---- create
const newProfile = (uid, over = {}) => ({ ...baseProfile(uid), createdAt: serverTimestamp(), ...over });
await test("student creates own profile as pending", () => assertSucceeds(setDoc(doc(as("C"), "users/C"), newProfile("C"))));
await test("create as approved is denied", () => assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { verificationStatus: "approved" }))));
await test("create with verifiedAt/reviewedAt/corVerifiedAt is denied", async () => { await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { verifiedAt: serverTimestamp() }))); await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { reviewedAt: serverTimestamp() }))); await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { corVerifiedAt: serverTimestamp() }))); });
await test("create with someone else's COR path / other uid / email mismatch / client timestamp is denied", async () => { await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { corStoragePath: "A/cor" }))); await assertFails(setDoc(doc(as("C"), "users/A2"), newProfile("A2"))); await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { email: "other@urs.edu.ph" }))); await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { createdAt: Timestamp.now() }))); });
await test("create with missing or extra fields is denied", async () => { const p = newProfile("C"); delete p.studentNumber; await assertFails(setDoc(doc(as("C"), "users/C"), p)); await assertFails(setDoc(doc(as("C"), "users/C"), newProfile("C", { isAdmin: true }))); });
await test("an existing profile cannot be re-created to reset it", () => assertFails(setDoc(doc(as("A"), "users/A"), newProfile("A"))));
// ---- student edits
await test("student edits name/username/campus", () => assertSucceeds(updateDoc(doc(as("A"), "users/A"), { fullName: "Ana R.", username: "ana2", campus: "URS Tanay" })));
await test("student cannot touch status, COR path, timestamps, student number, email, corVerifiedAt", async () => { for (const change of [{ verificationStatus: "approved" }, { corStoragePath: "B/cor" }, { verifiedAt: serverTimestamp() }, { reviewedAt: serverTimestamp() }, { studentNumber: "x" }, { email: "n@x.com" }, { corVerifiedAt: serverTimestamp() }, { isAdmin: true }]) await assertFails(updateDoc(doc(as("A"), "users/A"), change)); });
await test("student cannot edit another student, or blank their name", async () => { await assertFails(updateDoc(doc(as("A"), "users/B"), { campus: "URS Tanay" })); await assertFails(updateDoc(doc(as("A"), "users/A"), { fullName: "" })); });
// ---- admin review
const approve = { verificationStatus: "approved", verifiedAt: serverTimestamp(), reviewedAt: serverTimestamp() };
await test("admin CANNOT approve without corVerifiedAt", () => assertFails(updateDoc(doc(as("ADMIN"), "users/A"), approve)));
await test("admin approves once corVerifiedAt exists", () => assertSucceeds(updateDoc(doc(as("ADMIN"), "users/V"), approve)));
await test("admin approval with a client timestamp or extra fields is denied", async () => { await assertFails(updateDoc(doc(as("ADMIN"), "users/V"), { ...approve, verifiedAt: Timestamp.now() })); await assertFails(updateDoc(doc(as("ADMIN"), "users/V"), { ...approve, campus: "URS Tanay" })); await assertFails(updateDoc(doc(as("ADMIN"), "users/V"), { ...approve, corStoragePath: "x" })); });
await test("admin rejects (no COR check needed); verifiedAt stays null", async () => { await assertSucceeds(updateDoc(doc(as("ADMIN"), "users/A"), { verificationStatus: "rejected", verifiedAt: null, reviewedAt: serverTimestamp() })); await assertFails(updateDoc(doc(as("ADMIN"), "users/B"), { verificationStatus: "rejected", verifiedAt: serverTimestamp(), reviewedAt: serverTimestamp() })); });
await test("admin cannot set corVerifiedAt or any other status value", async () => { await assertFails(updateDoc(doc(as("ADMIN"), "users/A"), { corVerifiedAt: serverTimestamp() })); await assertFails(updateDoc(doc(as("ADMIN"), "users/V"), { verificationStatus: "superuser", verifiedAt: null, reviewedAt: serverTimestamp() })); });
await test("admin may approve their OWN profile (no circular dependency) once COR is attested", async () => { await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/ADMIN"), { ...baseProfile("ADMIN"), corVerifiedAt: Timestamp.now() })); await assertSucceeds(updateDoc(doc(as("ADMIN"), "users/ADMIN"), approve)); });
await test("nobody can delete a profile", async () => { for (const uid of ["A", "ADMIN"]) await assertFails(deleteDoc(doc(as(uid), "users/A"))); });
// ---- attestor
await test("attestor sets ONLY corVerifiedAt", async () => { await assertSucceeds(updateDoc(doc(as("ATT"), "users/A"), { corVerifiedAt: Timestamp.now() })); await assertFails(updateDoc(doc(as("ATT"), "users/A"), { verificationStatus: "approved" })); await assertFails(updateDoc(doc(as("ATT"), "users/A"), { corVerifiedAt: Timestamp.now(), campus: "x" })); });
await test("attestor cannot read profiles or create them", async () => { await assertFails(getDoc(doc(as("ATT"), "users/A"))); await assertFails(setDoc(doc(as("ATT"), "users/Z"), newProfile("Z"))); });
// "listings" is now a real collection (see marketplace.rules.test.mjs), so default-deny is checked on an unknown one.
await test("everything else is default-deny", () => assertFails(getDoc(doc(as("ADMIN"), "somethingElse/1"))));

await env.cleanup();
console.log(failed ? `\n${failed} FAILED` : "\nall rules tests passed");
process.exitCode = failed ? 1 : 0;

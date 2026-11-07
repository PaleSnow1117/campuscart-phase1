// Firestore rules tests for: editing/deleting messages, COR resubmission, e-mail sync, student-number review.
// Needs the Firebase emulator (and Java). From the project root:
//
//   npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs && node rules-tests/marketplace.rules.test.mjs && node rules-tests/profile-and-messages.rules.test.mjs"
//
// Uses only demo data inside the emulator. It never touches your real Firebase project.
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-campuscart",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
});
const T = (minute) => Timestamp.fromDate(new Date(Date.UTC(2026, 0, 1, 10, minute)));
const PEOPLE = {
  A: { name: "Ana Reyes", status: "approved" }, B: { name: "Ben Cruz", status: "approved" }, C: { name: "Cara Lim", status: "approved" },
  P: { name: "Pia Santos", status: "pending" }, R: { name: "Rey Dizon", status: "rejected" }, S: { name: "Sam Torres", status: "rejected" }, ADMIN: { name: "Admin Person", status: "approved" },
};
const profile = (uid, over = {}) => ({ fullName: PEOPLE[uid].name, username: uid.toLowerCase(), email: `${uid.toLowerCase()}@urs.edu.ph`, studentNumber: "2021-0001", campus: "URS Binangonan",
  verificationStatus: PEOPLE[uid].status, corStoragePath: `${uid}/cor`, createdAt: T(0), verifiedAt: null, ...over });
const CONV = "conversations/L1_B";
const reseed = async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of Object.keys(PEOPLE)) await setDoc(doc(db, `users/${uid}`), profile(uid));
    // S is a REJECTED student whose COR was reviewed and (earlier) attested
    await setDoc(doc(db, "users/S"), profile("S", { reviewedAt: T(5), corVerifiedAt: T(4) }));
    await setDoc(doc(db, "admins/ADMIN"), { note: "owner" });
    await setDoc(doc(db, "attestors/ATT"), { note: "backend" });
    // buyer B and seller A talked: MB1 (B), MA1 (A), MB2 (B, the latest)
    await setDoc(doc(db, CONV), { listingId: "L1", listingTitle: "Calculus book", listingPrice: 250, buyerId: "B", buyerName: "Ben C.", sellerId: "A", sellerName: "Ana R.",
      participants: ["B", "A"], lastMessage: "b2 text", lastMessageId: "MB2", createdAt: T(0), updatedAt: T(3) });
    await setDoc(doc(db, `${CONV}/messages/MB1`), { conversationId: "L1_B", senderId: "B", text: "b1 text", createdAt: T(1) });
    await setDoc(doc(db, `${CONV}/messages/MA1`), { conversationId: "L1_B", senderId: "A", text: "a1 text", createdAt: T(2) });
    await setDoc(doc(db, `${CONV}/messages/MB2`), { conversationId: "L1_B", senderId: "B", text: "b2 text", createdAt: T(3) });
  });
};
const as = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid.toLowerCase()}@urs.edu.ph`, ...claims }).firestore();
const out = () => env.unauthenticatedContext().firestore();
let failed = 0, passed = 0;
const test = async (name, fn) => { await reseed(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };
const edit = (db, id, text, over = {}) => updateDoc(doc(db, `${CONV}/messages/${id}`), { text, editedAt: serverTimestamp(), ...over });

// ============================== editing messages ==============================
await test("the sender can edit their own message (text + editedAt only)", () => assertSucceeds(edit(as("B"), "MB1", "b1 fixed")));
await test("the OTHER participant, an outsider, the admin and signed-out users cannot edit it", async () => { for (const u of ["A", "C", "ADMIN"]) await assertFails(edit(as(u), "MB1", "hacked")); await assertFails(edit(out(), "MB1", "hacked")); });
await test("an edit cannot change senderId, conversationId, createdAt, or add fields", async () => { for (const o of [{ senderId: "A" }, { conversationId: "OTHER" }, { createdAt: serverTimestamp() }, { extra: 1 }]) await assertFails(edit(as("B"), "MB1", "x", o)); });
await test("an edit must carry a server-time editedAt (not missing, not a client time)", async () => { await assertFails(updateDoc(doc(as("B"), `${CONV}/messages/MB1`), { text: "x" })); await assertFails(edit(as("B"), "MB1", "x", { editedAt: Timestamp.now() })); await assertFails(updateDoc(doc(as("B"), `${CONV}/messages/MB1`), { text: "x", editedAt: null })); });
await test("edited text must be 1-1000 characters and not blank", async () => { for (const bad of ["", "   ", "x".repeat(1001)]) await assertFails(edit(as("B"), "MB1", bad)); await assertSucceeds(edit(as("B"), "MB1", "x".repeat(1000))); });
await test("pending and rejected users cannot edit (they cannot send either)", async () => {
  for (const status of ["pending", "rejected"]) { await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/B"), profile("B", { verificationStatus: status }))); await assertFails(edit(as("B"), "MB1", "x")); } });
await test("an edit of the LATEST message may update the preview text in the same batch", async () => {
  const db = as("B"); const b = writeBatch(db); b.update(doc(db, `${CONV}/messages/MB2`), { text: "b2 fixed", editedAt: serverTimestamp() }); b.update(doc(db, CONV), { lastMessage: "b2 fixed" }); await assertSucceeds(b.commit()); });
await test("the preview cannot be changed to something that is not the latest message's real text", async () => {
  const db = as("B"); await assertFails(updateDoc(doc(db, CONV), { lastMessage: "forged preview" }));
  const b = writeBatch(db); b.update(doc(db, `${CONV}/messages/MB2`), { text: "b2 fixed", editedAt: serverTimestamp() }); b.update(doc(db, CONV), { lastMessage: "something else" }); await assertFails(b.commit()); });
await test("the other participant cannot rewrite the preview of a message they did not send", async () => {
  await assertFails(updateDoc(doc(as("A"), CONV), { lastMessage: "forged by A" }));
  await assertFails(updateDoc(doc(as("A"), CONV), { lastMessage: "forged by A", lastMessageId: "MA1" })); });

// ============================== deleting messages ==============================
await test("the sender can delete their own message; the other participant, outsiders, admin, signed-out cannot", async () => {
  for (const u of ["A", "C", "ADMIN"]) await assertFails(deleteDoc(doc(as(u), `${CONV}/messages/MB1`))); await assertFails(deleteDoc(doc(out(), `${CONV}/messages/MB1`)));
  await assertSucceeds(deleteDoc(doc(as("B"), `${CONV}/messages/MB1`))); await assertSucceeds(deleteDoc(doc(as("A"), `${CONV}/messages/MA1`))); });
await test("deleting an older message leaves the conversation and the other messages untouched", async () => {
  await assertSucceeds(deleteDoc(doc(as("B"), `${CONV}/messages/MB1`))); const c = await assertSucceeds(getDoc(doc(as("A"), CONV))); if (c.data().lastMessageId !== "MB2") throw new Error("conversation changed");
  await assertSucceeds(getDoc(doc(as("A"), `${CONV}/messages/MA1`))); await assertSucceeds(getDoc(doc(as("A"), `${CONV}/messages/MB2`))); });
await test("a rejected user can still delete their own message", async () => { await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/B"), profile("B", { verificationStatus: "rejected" }))); await assertSucceeds(deleteDoc(doc(as("B"), `${CONV}/messages/MB1`))); });
const deleteLatest = (db, preview) => { const b = writeBatch(db); b.delete(doc(db, `${CONV}/messages/MB2`)); if (preview) b.update(doc(db, CONV), preview); return b.commit(); };
await test("deleting the LATEST message: the preview moves to the newest remaining message (even the other person's)", () => assertSucceeds(deleteLatest(as("B"), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: T(2) })));
await test("the preview must point at a message that exists, with its exact text and time", async () => {
  await assertFails(deleteLatest(as("B"), { lastMessage: "a1 text", lastMessageId: "NOPE", updatedAt: T(2) }));
  await assertFails(deleteLatest(as("B"), { lastMessage: "forged", lastMessageId: "MA1", updatedAt: T(2) }));
  await assertFails(deleteLatest(as("B"), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: serverTimestamp() }));
  await assertFails(deleteLatest(as("B"), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: T(9) })); });
await test("the preview cannot be moved unless the latest message is really gone", async () => { const db = as("B"); const b = writeBatch(db); b.update(doc(db, CONV), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: T(2) }); await assertFails(b.commit()); });
await test("deleting the ONLY message empties the preview and resets updatedAt to when the conversation started", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await deleteDoc(doc(ctx.firestore(), `${CONV}/messages/MB1`)); await deleteDoc(doc(ctx.firestore(), `${CONV}/messages/MA1`)); });
  await assertFails(deleteLatest(as("B"), { lastMessage: "", lastMessageId: "", updatedAt: T(1) }));
  await assertSucceeds(deleteLatest(as("B"), { lastMessage: "", lastMessageId: "", updatedAt: T(0) })); });
await test("deleting the latest message cannot be used to change anything else in the conversation", async () => {
  for (const extra of [{ participants: ["B", "C"] }, { listingId: "L2" }, { buyerId: "C" }, { createdAt: T(9) }]) await assertFails(deleteLatest(as("B"), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: T(2), ...extra })); });
await test("if the latest message was deleted earlier, EITHER participant can repair the stale preview", async () => {
  await assertSucceeds(deleteDoc(doc(as("B"), `${CONV}/messages/MB2`)));
  await assertSucceeds(updateDoc(doc(as("A"), CONV), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: T(2) })); });
await test("outsiders cannot touch the conversation preview", async () => { await assertFails(updateDoc(doc(as("C"), CONV), { lastMessage: "x" })); await assertFails(deleteLatest(as("C"), { lastMessage: "a1 text", lastMessageId: "MA1", updatedAt: T(2) })); });
await test("messages can still be created normally, and conversations still cannot be deleted", async () => {
  const db = as("B"); const b = writeBatch(db); b.set(doc(db, `${CONV}/messages/MB3`), { conversationId: "L1_B", senderId: "B", text: "new", createdAt: serverTimestamp() }); b.update(doc(db, CONV), { lastMessage: "new", lastMessageId: "MB3", updatedAt: serverTimestamp() }); await assertSucceeds(b.commit());
  for (const u of ["A", "B", "ADMIN"]) await assertFails(deleteDoc(doc(as(u), CONV))); });

// ============================== COR resubmission ==============================
const resubmit = { verificationStatus: "pending", reviewedAt: null, corVerifiedAt: null };
await test("the attestor (the Edge Function) can reopen a REJECTED profile as pending, clearing review data and attestation", () => assertSucceeds(updateDoc(doc(as("ATT"), "users/S"), resubmit)));
await test("students can NEVER change their own verification status, including rejected -> pending", async () => { await assertFails(updateDoc(doc(as("S"), "users/S"), resubmit)); await assertFails(updateDoc(doc(as("S"), "users/S"), { verificationStatus: "pending" })); await assertFails(updateDoc(doc(as("S"), "users/S"), { verificationStatus: "approved" })); });
await test("the attestor cannot resubmit a PENDING or APPROVED profile", async () => { await assertFails(updateDoc(doc(as("ATT"), "users/P"), resubmit)); await assertFails(updateDoc(doc(as("ATT"), "users/A"), resubmit)); });
await test("the attestor's resubmission cannot approve, keep old review data, keep the old attestation, or touch other fields", async () => {
  for (const bad of [{ ...resubmit, verificationStatus: "approved" }, { ...resubmit, reviewedAt: serverTimestamp() }, { ...resubmit, corVerifiedAt: serverTimestamp() }, { ...resubmit, campus: "URS Tanay" }, { ...resubmit, studentNumber: "9999-9999" }, { ...resubmit, email: "x@x.com" }, { ...resubmit, corStoragePath: "x/cor" }, { ...resubmit, verifiedAt: serverTimestamp() }, { verificationStatus: "pending" }])
    await assertFails(updateDoc(doc(as("ATT"), "users/S"), bad)); });
await test("the admin cannot reopen a profile as pending either (the admin only approves or rejects)", async () => { await assertFails(updateDoc(doc(as("ADMIN"), "users/S"), { verificationStatus: "pending", verifiedAt: null, reviewedAt: serverTimestamp() })); });
await test("after resubmission an approval needs a FRESH attestation of the new file", async () => {
  await assertSucceeds(updateDoc(doc(as("ATT"), "users/S"), resubmit));
  const approve = { verificationStatus: "approved", verifiedAt: serverTimestamp(), reviewedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(as("ADMIN"), "users/S"), approve));                                            // old attestation was cleared
  await assertSucceeds(updateDoc(doc(as("ATT"), "users/S"), { corVerifiedAt: Timestamp.now() }));                 // verify-cor on the new file
  await assertSucceeds(updateDoc(doc(as("ADMIN"), "users/S"), approve)); });
await test("a rejected student keeps normal read access to their profile and still cannot touch protected fields", async () => { await assertSucceeds(getDoc(doc(as("S"), "users/S"))); for (const c of [{ studentNumber: "1" }, { corStoragePath: "x" }, { reviewedAt: null }, { corVerifiedAt: null }, { verifiedAt: serverTimestamp() }]) await assertFails(updateDoc(doc(as("S"), "users/S"), c)); });

// ============================== e-mail sync ==============================
await test("after verifying a new e-mail, the profile may follow, but only to the VERIFIED e-mail in the token", async () => {
  await assertSucceeds(updateDoc(doc(as("A", { email: "new@urs.edu.ph", email_verified: true }), "users/A"), { email: "new@urs.edu.ph" }));
  await assertSucceeds(updateDoc(doc(as("B", { email: "New2@URS.edu.ph", email_verified: true }), "users/B"), { email: "new2@urs.edu.ph" })); });
await test("the e-mail cannot be changed freely: unverified token, different address, extra fields, or someone else's profile", async () => {
  await assertFails(updateDoc(doc(as("A"), "users/A"), { email: "new@urs.edu.ph" }));                                                                   // token e-mail is a@..., not new@...
  await assertFails(updateDoc(doc(as("A", { email: "new@urs.edu.ph", email_verified: false }), "users/A"), { email: "new@urs.edu.ph" }));
  await assertFails(updateDoc(doc(as("A", { email: "new@urs.edu.ph", email_verified: true }), "users/A"), { email: "other@urs.edu.ph" }));
  await assertFails(updateDoc(doc(as("A", { email: "new@urs.edu.ph", email_verified: true }), "users/A"), { email: "new@urs.edu.ph", campus: "URS Tanay" }));
  await assertFails(updateDoc(doc(as("C", { email: "new@urs.edu.ph", email_verified: true }), "users/A"), { email: "new@urs.edu.ph" })); });

// ============================== student number: request + review ==============================
const request = (over = {}) => ({ requestedNumber: "2022-00999", currentNumber: "2021-0001", status: "pending", requestedAt: serverTimestamp(), reviewedAt: null, ...over });
const SN = (uid) => `studentNumberRequests/${uid}`;
await test("a student can ask for a number change (pending), and read their own request", async () => { await assertSucceeds(setDoc(doc(as("A"), SN("A")), request())); await assertSucceeds(getDoc(doc(as("A"), SN("A")))); });
await test("a request must be well-formed: pending, server time, the real current number, a different valid number, nothing extra", async () => {
  for (const bad of [{ status: "approved" }, { status: "rejected" }, { reviewedAt: serverTimestamp() }, { requestedAt: Timestamp.now() }, { currentNumber: "0000-0000" }, { requestedNumber: "2021-0001" }, { requestedNumber: "!!" }, { requestedNumber: "x".repeat(40) }, { extra: 1 }])
    await assertFails(setDoc(doc(as("A"), SN("A")), request(bad))); });
await test("a student cannot file a request for someone else, and others cannot read it", async () => { await assertFails(setDoc(doc(as("A"), SN("B")), request())); await assertSucceeds(setDoc(doc(as("A"), SN("A")), request())); for (const u of ["B", "C"]) await assertFails(getDoc(doc(as(u), SN("A")))); await assertFails(getDoc(doc(out(), SN("A")))); });
await test("a student can send a new request after a decision, but can never mark their own request approved", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), SN("A")), { ...request(), requestedAt: T(1), status: "rejected", reviewedAt: T(2) }));
  await assertSucceeds(setDoc(doc(as("A"), SN("A")), request({ requestedNumber: "2022-00111" })));
  await assertFails(updateDoc(doc(as("A"), SN("A")), { status: "approved", reviewedAt: serverTimestamp() })); });
await test("only the admin lists requests", async () => { await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), SN("A")), { ...request(), requestedAt: T(1) })); await assertSucceeds(getDocs(collection(as("ADMIN"), "studentNumberRequests"))); for (const u of ["A", "C"]) await assertFails(getDocs(collection(as(u), "studentNumberRequests"))); });
const seedRequest = (over = {}) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), SN("A")), { ...request(), requestedAt: T(1), ...over }));
await test("the admin approves: the request is closed AND the number changes, in one batch", async () => {
  await seedRequest(); const db = as("ADMIN"); const b = writeBatch(db); b.update(doc(db, SN("A")), { status: "approved", reviewedAt: serverTimestamp() }); b.update(doc(db, "users/A"), { studentNumber: "2022-00999" }); await assertSucceeds(b.commit()); });
await test("the admin cannot change a student number on its own, with a different number, or after rejecting", async () => {
  await seedRequest(); const db = as("ADMIN");
  await assertFails(updateDoc(doc(db, "users/A"), { studentNumber: "2022-00999" }));
  const wrong = writeBatch(db); wrong.update(doc(db, SN("A")), { status: "approved", reviewedAt: serverTimestamp() }); wrong.update(doc(db, "users/A"), { studentNumber: "2099-99999" }); await assertFails(wrong.commit());
  const rejected = writeBatch(db); rejected.update(doc(db, SN("A")), { status: "rejected", reviewedAt: serverTimestamp() }); rejected.update(doc(db, "users/A"), { studentNumber: "2022-00999" }); await assertFails(rejected.commit());
  const extra = writeBatch(db); extra.update(doc(db, SN("A")), { status: "approved", reviewedAt: serverTimestamp() }); extra.update(doc(db, "users/A"), { studentNumber: "2022-00999", campus: "URS Tanay" }); await assertFails(extra.commit()); });
await test("the admin can reject a request without changing the number; decided requests can't be re-decided; others can't decide", async () => {
  await seedRequest(); await assertSucceeds(updateDoc(doc(as("ADMIN"), SN("A")), { status: "rejected", reviewedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as("ADMIN"), SN("A")), { status: "approved", reviewedAt: serverTimestamp() }));
  await seedRequest(); for (const u of ["A", "B"]) await assertFails(updateDoc(doc(as(u), SN("A")), { status: "approved", reviewedAt: serverTimestamp() })); });
await test("a review cannot change anything but status and reviewedAt, nor use odd statuses or a client time", async () => {
  await seedRequest(); for (const bad of [{ status: "pending", reviewedAt: serverTimestamp() }, { status: "approved", reviewedAt: Timestamp.now() }, { status: "approved", reviewedAt: serverTimestamp(), requestedNumber: "1999-1" }, { status: "superuser", reviewedAt: serverTimestamp() }])
    await assertFails(updateDoc(doc(as("ADMIN"), SN("A")), bad)); });
await test("students still cannot change their own student number directly, and requests can't be deleted", async () => { await assertFails(updateDoc(doc(as("A"), "users/A"), { studentNumber: "2022-00999" })); await seedRequest(); for (const u of ["A", "ADMIN"]) await assertFails(deleteDoc(doc(as(u), SN("A")))); });

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

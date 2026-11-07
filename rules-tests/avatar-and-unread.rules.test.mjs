// Firestore rules tests for: profile pictures (users/{uid}.photoPath / photoUpdatedAt) and unread-message markers
// (users/{recipient}/unread/{messageId}).
// Needs the Firebase emulator (and Java). From the project root:
//
//   npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs && node rules-tests/marketplace.rules.test.mjs && node rules-tests/profile-and-messages.rules.test.mjs && node rules-tests/avatar-and-unread.rules.test.mjs"
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
  P: { name: "Pia Santos", status: "pending" }, R: { name: "Rey Dizon", status: "rejected" }, ADMIN: { name: "Admin Person", status: "approved" },
};
const profile = (uid, over = {}) => ({ fullName: PEOPLE[uid].name, username: uid.toLowerCase(), email: `${uid.toLowerCase()}@urs.edu.ph`, studentNumber: "2021-0001", campus: "URS Binangonan",
  verificationStatus: PEOPLE[uid].status, corStoragePath: `${uid}/cor`, createdAt: T(0), verifiedAt: null, ...over });
const CONV = "conversations/L1_B";
const reseed = async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of Object.keys(PEOPLE)) await setDoc(doc(db, `users/${uid}`), profile(uid));
    await setDoc(doc(db, "admins/ADMIN"), { note: "owner" });
    await setDoc(doc(db, "attestors/ATT"), { note: "backend" });
    // buyer B and seller A: B wrote MB1 (old), A wrote MA1
    await setDoc(doc(db, CONV), { listingId: "L1", listingTitle: "Calculus book", listingPrice: 250, buyerId: "B", buyerName: "Ben C.", sellerId: "A", sellerName: "Ana R.",
      participants: ["B", "A"], lastMessage: "a1 text", lastMessageId: "MA1", createdAt: T(0), updatedAt: T(2) });
    await setDoc(doc(db, `${CONV}/messages/MB1`), { conversationId: "L1_B", senderId: "B", text: "b1 text", createdAt: T(1) });
    await setDoc(doc(db, `${CONV}/messages/MA1`), { conversationId: "L1_B", senderId: "A", text: "a1 text", createdAt: T(2) });
    // MB1 was sent to A and is still unread: A holds a marker for it
    await setDoc(doc(db, "users/A/unread/MB1"), { conversationId: "L1_B", senderId: "B", createdAt: T(1) });
    // a conversation with a rejected (unverified) buyer
    await setDoc(doc(db, "conversations/L2_R"), { listingId: "L2", listingTitle: "Pen", listingPrice: 5, buyerId: "R", buyerName: "Rey D.", sellerId: "A", sellerName: "Ana R.",
      participants: ["R", "A"], lastMessage: "", lastMessageId: "", createdAt: T(0), updatedAt: T(0) });
  });
};
const as = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid.toLowerCase()}@urs.edu.ph`, ...claims }).firestore();
const out = () => env.unauthenticatedContext().firestore();
let failed = 0, passed = 0;
const test = async (name, fn) => { await reseed(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };

// ============================== profile pictures ==============================
const setPhoto = (db, uid, over = {}) => updateDoc(doc(db, `users/${uid}`), { photoPath: `${uid}/avatar`, photoUpdatedAt: serverTimestamp(), ...over });
await test("a student sets their OWN picture path with a server time", () => assertSucceeds(setPhoto(as("A"), "A")));
await test("pending and rejected students may have a picture too", async () => { await assertSucceeds(setPhoto(as("P"), "P")); await assertSucceeds(setPhoto(as("R"), "R")); });
await test("replacing an existing picture is allowed (same path, new server time)", async () => { await assertSucceeds(setPhoto(as("A"), "A")); await assertSucceeds(setPhoto(as("A"), "A")); });
await test("removing it (both fields null) is allowed, also when none was ever set", async () => {
  await assertSucceeds(updateDoc(doc(as("A"), "users/A"), { photoPath: null, photoUpdatedAt: null })); await assertSucceeds(setPhoto(as("B"), "B")); await assertSucceeds(updateDoc(doc(as("B"), "users/B"), { photoPath: null, photoUpdatedAt: null })); });
await test("a path pointing at ANOTHER student's folder is refused", async () => { await assertFails(setPhoto(as("A"), "A", { photoPath: "B/avatar" })); await assertFails(setPhoto(as("A"), "A", { photoPath: "B/cor" })); });
await test("any other path is refused (COR, traversal, extra segments, other names, empty, wrong type)", async () => {
  for (const bad of ["A/cor", "A/avatar.png", "A/avatar/x", "A/../B/avatar", "../A/avatar", "avatar", "", "A", "a/avatar", 42, true, ["A/avatar"]]) await assertFails(setPhoto(as("A"), "A", { photoPath: bad })); });
await test("the change time must be the SERVER time (client time, missing, or null with a path are refused)", async () => {
  await assertFails(setPhoto(as("A"), "A", { photoUpdatedAt: Timestamp.now() })); await assertFails(setPhoto(as("A"), "A", { photoUpdatedAt: null })); await assertFails(updateDoc(doc(as("A"), "users/A"), { photoPath: "A/avatar" }));
  await assertFails(updateDoc(doc(as("A"), "users/A"), { photoPath: null, photoUpdatedAt: serverTimestamp() })); await assertFails(updateDoc(doc(as("A"), "users/A"), { photoPath: null })); });
await test("the picture update can't smuggle in any other field (status, name, campus, student number, COR path, admin flags)", async () => {
  for (const extra of [{ verificationStatus: "rejected" }, { campus: "URS Tanay" }, { fullName: "Hacker" }, { studentNumber: "9" }, { corStoragePath: "B/cor" }, { reviewedAt: serverTimestamp() }, { corVerifiedAt: serverTimestamp() }, { isAdmin: true }]) await assertFails(setPhoto(as("A"), "A", extra)); });
await test("nobody can set or remove ANOTHER student's picture (student, admin, attestor, signed-out)", async () => {
  await assertFails(setPhoto(as("A"), "B")); await assertFails(setPhoto(as("ADMIN"), "B")); await assertFails(setPhoto(as("ATT"), "B")); await assertFails(setPhoto(out(), "B"));
  await assertFails(updateDoc(doc(as("A"), "users/B"), { photoPath: null, photoUpdatedAt: null })); await assertFails(updateDoc(doc(as("ADMIN"), "users/B"), { photoPath: null, photoUpdatedAt: null })); });
await test("a picture change does not weaken the other profile rules (name edits still work, status still can't be changed)", async () => {
  await assertSucceeds(setPhoto(as("A"), "A")); await assertSucceeds(updateDoc(doc(as("A"), "users/A"), { fullName: "Ana R. Reyes" })); await assertFails(updateDoc(doc(as("A"), "users/A"), { verificationStatus: "rejected", photoPath: "A/avatar", photoUpdatedAt: serverTimestamp() })); });
await test("a new profile can't be created with picture fields (signup stays exactly as before)", () =>
  assertFails(setDoc(doc(as("N"), "users/N"), { ...profile("A"), email: "n@urs.edu.ph", corStoragePath: "N/cor", createdAt: serverTimestamp(), photoPath: "N/avatar", photoUpdatedAt: serverTimestamp() })));
await test("a profile is still private: other students can't read it (so the picture path isn't exposed through Firestore)", async () => { await assertSucceeds(setPhoto(as("A"), "A")); await assertFails(getDoc(doc(as("B"), "users/A"))); });

// ============================== unread markers ==============================
/** B sends a new message to A: message + preview + marker, in ONE batch (exactly what the app does). */
const sendBatch = (db, { sender = "B", recipient = "A", markerSender = sender, conversationId = "L1_B", withMarker = true, markerOver = {}, convPath = CONV, msgId = "NEW1", markerPath } = {}) => {
  const b = writeBatch(db);
  b.set(doc(db, `${convPath}/messages/${msgId}`), { conversationId, senderId: sender, text: "hello", createdAt: serverTimestamp() });
  b.update(doc(db, convPath), { lastMessage: "hello", lastMessageId: msgId, updatedAt: serverTimestamp() });
  if (withMarker) b.set(doc(db, markerPath ?? `users/${recipient}/unread/${msgId}`), { conversationId, senderId: markerSender, createdAt: serverTimestamp(), ...markerOver });
  return b.commit();
};
await test("sending: the message, the preview and the recipient's marker in one batch succeeds", () => assertSucceeds(sendBatch(as("B"))));
await test("sending works the other way round too (seller to buyer)", () => assertSucceeds(sendBatch(as("A"), { sender: "A", recipient: "B", markerSender: "A" })));
await test("the batch without a marker still works (older app versions keep sending messages)", () => assertSucceeds(sendBatch(as("B"), { withMarker: false })));
await test("a marker can't be created alone, without a message in the same request", async () => {
  await assertFails(setDoc(doc(as("B"), "users/A/unread/GHOST"), { conversationId: "L1_B", senderId: "B", createdAt: serverTimestamp() })); });
await test("a marker can't mark an OLD message unread again (e.g. after the recipient read it)", async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "users/A/unread/MB1")));
  await assertFails(setDoc(doc(as("B"), "users/A/unread/MB1"), { conversationId: "L1_B", senderId: "B", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as("B"), "users/A/unread/MB1"), { conversationId: "L1_B", senderId: "B", createdAt: T(1) })); });
await test("a marker can only go to the OTHER participant (not yourself, not an outsider, not the admin)", async () => {
  await assertFails(sendBatch(as("B"), { recipient: "B" })); await assertFails(sendBatch(as("B"), { recipient: "C" })); await assertFails(sendBatch(as("B"), { recipient: "ADMIN" })); });
await test("the marker must name the real sender, the real conversation, and a server time", async () => {
  await assertFails(sendBatch(as("B"), { markerSender: "A" })); await assertFails(sendBatch(as("B"), { markerOver: { conversationId: "L2_R" } })); await assertFails(sendBatch(as("B"), { markerOver: { createdAt: Timestamp.now() } }));
  await assertFails(sendBatch(as("B"), { markerOver: { createdAt: T(5) } })); });
await test("a marker can't carry extra or missing fields, or a non-string conversation id", async () => {
  await assertFails(sendBatch(as("B"), { markerOver: { text: "spam" } })); await assertFails(sendBatch(as("B"), { markerOver: { read: false } })); await assertFails(sendBatch(as("B"), { markerOver: { conversationId: 5 } }));
  await assertFails(sendBatch(as("B"), { markerOver: { conversationId: "../x" } })); });
await test("the marker id must be the message id (a marker under another id is refused)", () => assertFails(sendBatch(as("B"), { markerPath: "users/A/unread/OTHER" })));
await test("an outsider can't send into the conversation or plant a marker for its members", async () => { await assertFails(sendBatch(as("C"), { sender: "C", recipient: "A", markerSender: "C" })); await assertFails(sendBatch(as("C"), { sender: "B", recipient: "A", markerSender: "B" })); });
await test("a marker can't be planted for a message that belongs to someone else (sender mismatch)", async () => {
  const db = as("B"); const b = writeBatch(db); b.set(doc(db, `${CONV}/messages/NEW2`), { conversationId: "L1_B", senderId: "B", text: "x", createdAt: serverTimestamp() }); b.update(doc(db, CONV), { lastMessage: "x", lastMessageId: "NEW2", updatedAt: serverTimestamp() });
  b.set(doc(db, "users/A/unread/MA1"), { conversationId: "L1_B", senderId: "B", createdAt: serverTimestamp() }); await assertFails(b.commit()); });
await test("an unverified (rejected) participant can't create messages or markers", () => assertFails(sendBatch(as("R"), { sender: "R", recipient: "A", markerSender: "R", conversationId: "L2_R", convPath: "conversations/L2_R" })));
await test("messages keep their exact shape: an extra 'unreadFor' style field on a message is still refused", async () => {
  const db = as("B"); const b = writeBatch(db); b.set(doc(db, `${CONV}/messages/NEW3`), { conversationId: "L1_B", senderId: "B", text: "x", createdAt: serverTimestamp(), unreadFor: "A" }); b.update(doc(db, CONV), { lastMessage: "x", lastMessageId: "NEW3", updatedAt: serverTimestamp() }); await assertFails(b.commit()); });

// ---- reading markers: only their owner
await test("the recipient can read their own markers (single and list), nobody else can", async () => {
  await assertSucceeds(getDoc(doc(as("A"), "users/A/unread/MB1"))); await assertSucceeds(getDocs(collection(as("A"), "users/A/unread")));
  for (const who of [as("B"), as("C"), as("ADMIN"), out()]) { await assertFails(getDoc(doc(who, "users/A/unread/MB1"))); await assertFails(getDocs(collection(who, "users/A/unread"))); } });
await test("the SENDER can't read the recipient's markers either (so they can't see whether a message was read)", async () => { await assertFails(getDoc(doc(as("B"), "users/A/unread/MB1"))); await assertFails(getDocs(collection(as("B"), "users/A/unread"))); });

// ---- marking as read / removing markers
await test("the recipient marks as read by deleting their own markers (single and batch)", async () => {
  await assertSucceeds(deleteDoc(doc(as("A"), "users/A/unread/MB1"))); await assertSucceeds(sendBatch(as("B"))); await assertSucceeds(sendBatch(as("B"), { msgId: "NEW9" }));
  const db = as("A"); const b = writeBatch(db); b.delete(doc(db, "users/A/unread/NEW1")); b.delete(doc(db, "users/A/unread/NEW9")); await assertSucceeds(b.commit()); });
await test("marking as read when the marker is already gone is not an error (idempotent, any device)", async () => { await assertSucceeds(deleteDoc(doc(as("A"), "users/A/unread/MB1"))); await assertSucceeds(deleteDoc(doc(as("A"), "users/A/unread/MB1"))); });
await test("nobody can delete SOMEONE ELSE'S marker unless they sent that message", async () => {
  await assertFails(deleteDoc(doc(as("C"), "users/A/unread/MB1"))); await assertFails(deleteDoc(doc(as("ADMIN"), "users/A/unread/MB1"))); await assertFails(deleteDoc(doc(out(), "users/A/unread/MB1")));
  await assertSucceeds(deleteDoc(doc(as("A"), "users/B/unread/NOTHING-HERE"))); /* deleting a marker that does not exist is a harmless no-op and reveals nothing */ });
await test("the SENDER can delete the marker of the message they sent (needed when they delete the message)", () => assertSucceeds(deleteDoc(doc(as("B"), "users/A/unread/MB1"))));
await test("deleting a message and its marker together works for the sender (the app does this in one transaction)", async () => {
  const db = as("B"); const b = writeBatch(db); b.delete(doc(db, `${CONV}/messages/MB1`)); b.delete(doc(db, "users/A/unread/MB1")); await assertSucceeds(b.commit()); });
await test("deleting the marker of a message that was already read (no marker exists) does not break deleting the message", async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "users/A/unread/MB1")));
  const db = as("B"); const b = writeBatch(db); b.delete(doc(db, `${CONV}/messages/MB1`)); b.delete(doc(db, "users/A/unread/MB1")); await assertSucceeds(b.commit()); });
await test("markers can never be updated (not by the owner, the sender, or anyone)", async () => {
  for (const who of [as("A"), as("B"), as("ADMIN")]) { await assertFails(updateDoc(doc(who, "users/A/unread/MB1"), { conversationId: "L2_R" })); await assertFails(updateDoc(doc(who, "users/A/unread/MB1"), { senderId: "A" })); } });
await test("a marker can't be overwritten with set (still unreadable, uneditable)", async () => { await assertFails(setDoc(doc(as("A"), "users/A/unread/MB1"), { conversationId: "L1_B", senderId: "B", createdAt: serverTimestamp() })); });
await test("markers don't open up anything else under users/ (profile and saved stay private)", async () => { await assertFails(getDoc(doc(as("B"), "users/A"))); await assertFails(getDocs(collection(as("B"), "users/A/saved"))); await assertFails(getDocs(collection(as("ADMIN"), "users/A/unread"))); });
await test("admin power is unchanged: the admin still can't read conversations or messages", async () => { await assertFails(getDoc(doc(as("ADMIN"), CONV))); await assertFails(getDoc(doc(as("ADMIN"), `${CONV}/messages/MB1`))); });
await test("editing and deleting messages by their sender is unaffected by markers existing", async () => {
  await assertSucceeds(updateDoc(doc(as("B"), `${CONV}/messages/MB1`), { text: "b1 fixed", editedAt: serverTimestamp() })); await assertFails(updateDoc(doc(as("A"), `${CONV}/messages/MB1`), { text: "hacked", editedAt: serverTimestamp() })); });

await env.cleanup();
console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} rules tests passed`);
process.exitCode = failed ? 1 : 0;

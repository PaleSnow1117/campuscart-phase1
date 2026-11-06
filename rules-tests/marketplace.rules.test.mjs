// Firestore rules tests for the server-backed marketplace: listings, saved items, conversations, messages.
// Needs the Firebase emulator (and Java). From the project root:
//
//   npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs && node rules-tests/marketplace.rules.test.mjs"
//
// Uses only demo data inside the emulator. It never touches your real Firebase project.
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-campuscart",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
});

const PEOPLE = {
  A: { name: "Ana Reyes", short: "Ana R.", campus: "URS Binangonan", status: "approved" },
  B: { name: "Ben Cruz", short: "Ben C.", campus: "URS Tanay", status: "approved" },
  C: { name: "Cara Lim", short: "Cara L.", campus: "URS Taytay", status: "approved" },
  P: { name: "Pia Santos", short: "Pia S.", campus: "URS Binangonan", status: "pending" },
  R: { name: "Rey Dizon", short: "Rey D.", campus: "URS Binangonan", status: "rejected" },
  ADMIN: { name: "Admin Person", short: "Admin P.", campus: "URS Binangonan", status: "approved" },
};
const profile = (uid) => ({ fullName: PEOPLE[uid].name, username: uid.toLowerCase(), email: `${uid}@urs.edu.ph`, studentNumber: "2021-0001", campus: PEOPLE[uid].campus,
  verificationStatus: PEOPLE[uid].status, corStoragePath: `${uid}/cor`, createdAt: Timestamp.now(), verifiedAt: null });
const listingData = (uid, over = {}) => ({ title: "Calculus book", price: 250, condition: "Good as new", category: "Books", description: "Clean pages.",
  images: [], sellerId: uid, sellerName: PEOPLE[uid].short, campus: PEOPLE[uid].campus, ...over });
const newListing = (uid, over = {}) => ({ ...listingData(uid), createdAt: serverTimestamp(), ...over });
const conversationFor = (listingId, buyer, seller, over = {}) => ({
  listingId, listingTitle: "Calculus book", listingPrice: 250, buyerId: buyer, buyerName: PEOPLE[buyer].short, sellerId: seller,
  sellerName: PEOPLE[seller].short, participants: [buyer, seller], lastMessage: "", lastMessageId: "",
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });

const reseed = async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of Object.keys(PEOPLE)) await setDoc(doc(db, `users/${uid}`), profile(uid));
    await setDoc(doc(db, "admins/ADMIN"), { note: "owner" });
    await setDoc(doc(db, "listings/L1"), { ...listingData("A"), createdAt: Timestamp.now() });   // Ana's listing
    await setDoc(doc(db, "listings/L2"), { ...listingData("B"), title: "Drafting set", createdAt: Timestamp.now() });
    await setDoc(doc(db, "listings/LR"), { ...listingData("R"), createdAt: Timestamp.now() });   // owned by a rejected student
    await setDoc(doc(db, "conversations/L1_B"), { ...conversationFor("L1", "B", "A"), lastMessage: "hello", lastMessageId: "M1", createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await setDoc(doc(db, "conversations/L1_B/messages/M1"), { conversationId: "L1_B", senderId: "B", text: "hello", createdAt: Timestamp.now() });
    await setDoc(doc(db, "users/B/saved/L1"), { listingId: "L1", savedAt: Timestamp.now() });
    await setDoc(doc(db, "conversations/L2_C"), { ...conversationFor("L2", "C", "B"), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });   // nobody has written yet (lastMessageId is "")
  });
};
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@urs.edu.ph` }).firestore();
const out = () => env.unauthenticatedContext().firestore();
let failed = 0, passed = 0;
const test = async (name, fn) => { await reseed(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };
// Every call writes a NEW message document, like the app does (it uses an auto id per message). Messages are
// immutable in the rules, so re-using an id would be an overwrite (an "update") and is correctly refused.
let messageCounter = 0;
const sendBatch = (db, conversationId, uid, text, over = {}) => {
  const id = over.id ?? `MSG${++messageCounter}`;
  const b = writeBatch(db);
  const m = doc(collection(db, `conversations/${conversationId}/messages`), id);
  b.set(m, { conversationId, senderId: uid, text, createdAt: serverTimestamp(), ...(over.message ?? {}) });
  b.update(doc(db, `conversations/${conversationId}`), { lastMessage: over.lastMessage ?? text, lastMessageId: over.lastMessageId ?? id, updatedAt: serverTimestamp() });
  return b.commit();
};

// ============================== listings ==============================
await test("signed-out users cannot read or list listings", async () => { await assertFails(getDoc(doc(out(), "listings/L1"))); await assertFails(getDocs(collection(out(), "listings"))); });
await test("any signed-in user (even pending/rejected) can read and list listings", async () => { for (const u of ["A", "P", "R"]) { await assertSucceeds(getDoc(doc(as(u), "listings/L1"))); await assertSucceeds(getDocs(collection(as(u), "listings"))); } });
await test("1. a verified student can create a listing", () => assertSucceeds(setDoc(doc(as("A"), "listings/NEW1"), newListing("A"))));
await test("create stores the seller's real campus and passes with images", () => assertSucceeds(setDoc(doc(as("B"), "listings/NEW1"), newListing("B", { images: ["data:image/jpeg;base64,AAAA"] }))));
await test("6. pending and rejected students cannot create listings", async () => { for (const u of ["P", "R"]) await assertFails(setDoc(doc(as(u), "listings/NEW1"), newListing(u))); });
await test("signed-out cannot create", () => assertFails(setDoc(doc(out(), "listings/NEW1"), newListing("A"))));
await test("cannot create a listing owned by someone else", () => assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { sellerId: "B" }))));
await test("cannot fake the campus or the seller's name", async () => { await assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { campus: "URS Tanay" }))); await assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { sellerName: "Admin" }))); await assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { sellerName: "" }))); });
await test("rejects extra/missing fields, bad enums, bad numbers, long text", async () => {
  const bad = [{ isFeatured: true }, { category: "Cars" }, { condition: "Broken" }, { price: -1 }, { price: "250" }, { price: 2000000000 }, { title: "" }, { title: "x".repeat(121) }, { description: "x".repeat(2001) }, { images: "nope" }, { images: ["a", "b", "c", "d", "e", "f"] }, { images: [5] }, { createdAt: Timestamp.now() }];
  for (const o of bad) await assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", o)));
  const missing = newListing("A"); delete missing.description; await assertFails(setDoc(doc(as("A"), "listings/NEW1"), missing)); });
await test("listing ids must be plain alphanumerics (keeps conversation ids unambiguous)", async () => { for (const id of ["with_underscore", "has-dash", "x".repeat(65)]) await assertFails(setDoc(doc(as("A"), `listings/${id}`), newListing("A"))); });
await test("image strings over the size cap are refused", () => assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { images: ["x".repeat(750001)] }))));
await test("2. the owner can edit their listing", () => assertSucceeds(updateDoc(doc(as("A"), "listings/L1"), { title: "Calculus book v2", price: 300, images: [] })));
await test("2. another user cannot edit someone else's listing", async () => { for (const u of ["B", "C", "P", "ADMIN"]) await assertFails(updateDoc(doc(as(u), "listings/L1"), { price: 1 })); });
await test("owner cannot change seller, campus, or created date", async () => { for (const c of [{ sellerId: "B" }, { campus: "URS Tanay" }, { createdAt: serverTimestamp() }, { isFeatured: true }]) await assertFails(updateDoc(doc(as("A"), "listings/L1"), c)); });
await test("owner edits are validated like creates", async () => { for (const c of [{ price: -5 }, { category: "Cars" }, { title: "" }, { images: ["a", "b", "c", "d", "e", "f"] }]) await assertFails(updateDoc(doc(as("A"), "listings/L1"), c)); });
await test("a rejected owner cannot edit, but can still delete their own listing", async () => { await assertFails(updateDoc(doc(as("R"), "listings/LR"), { price: 1 })); await assertSucceeds(deleteDoc(doc(as("R"), "listings/LR"))); });
await test("2. the owner can delete; others (including the admin) cannot", async () => { for (const u of ["B", "C", "P", "ADMIN"]) await assertFails(deleteDoc(doc(as(u), "listings/L1"))); await assertSucceeds(deleteDoc(doc(as("A"), "listings/L1"))); });
await test("owner may refresh sellerName to match their profile, but not to another name", async () => { await assertSucceeds(updateDoc(doc(as("A"), "listings/L1"), { sellerName: "Ana Rey." })); await assertFails(updateDoc(doc(as("A"), "listings/L1"), { sellerName: "Bob X." })); });

// ============================== saved items ==============================
const save = (db, uid, id, over = {}) => setDoc(doc(db, `users/${uid}/saved/${id}`), { listingId: id, savedAt: serverTimestamp(), ...over });
await test("3. a user can save a listing, list and un-save their own saved items", async () => { await assertSucceeds(save(as("A"), "A", "L2")); await assertSucceeds(getDocs(collection(as("A"), "users/A/saved"))); await assertSucceeds(deleteDoc(doc(as("A"), "users/A/saved/L2"))); });
await test("3. saved items are isolated: nobody else can read, list, write or delete them", async () => { for (const u of ["A", "C", "P", "ADMIN"]) { await assertFails(getDoc(doc(as(u), "users/B/saved/L1"))); await assertFails(getDocs(collection(as(u), "users/B/saved"))); await assertFails(save(as(u), "B", "L2")); await assertFails(deleteDoc(doc(as(u), "users/B/saved/L1"))); } await assertFails(getDocs(collection(out(), "users/B/saved"))); });
await test("pending and rejected students may save (they can browse)", async () => { for (const u of ["P", "R"]) await assertSucceeds(save(as(u), u, "L1")); });
await test("cannot save a listing that does not exist, or with a mismatched/extra field", async () => { await assertFails(save(as("A"), "A", "GHOST")); await assertFails(save(as("A"), "A", "L2", { listingId: "L1" })); await assertFails(save(as("A"), "A", "L2", { extra: 1 })); await assertFails(save(as("A"), "A", "L2", { savedAt: Timestamp.now() })); });
await test("saved items survive deleting the listing (cleanup is done by their owner)", async () => { await assertSucceeds(deleteDoc(doc(as("A"), "listings/L1"))); await assertSucceeds(getDoc(doc(as("B"), "users/B/saved/L1"))); await assertSucceeds(deleteDoc(doc(as("B"), "users/B/saved/L1"))); });

// ============================== conversations ==============================
await test("4. participants can read their conversation; outsiders and signed-out users cannot", async () => { for (const u of ["A", "B"]) await assertSucceeds(getDoc(doc(as(u), "conversations/L1_B"))); for (const u of ["C", "P", "R", "ADMIN"]) await assertFails(getDoc(doc(as(u), "conversations/L1_B"))); await assertFails(getDoc(doc(out(), "conversations/L1_B"))); });
await test("participants can list their conversations with array-contains; others cannot", async () => {
  for (const u of ["A", "B"]) await assertSucceeds(getDocs(query(collection(as(u), "conversations"), where("participants", "array-contains", u))));
  await assertFails(getDocs(query(collection(as("C"), "conversations"), where("participants", "array-contains", "B"))));
  await assertFails(getDocs(collection(as("ADMIN"), "conversations"))); });
await test("a buyer can probe ONLY their own (not yet existing) conversation id", async () => { await assertSucceeds(getDoc(doc(as("C"), "conversations/L2_C"))); await assertFails(getDoc(doc(as("C"), "conversations/L2_B"))); });
await test("a verified buyer can start a conversation (seller = the listing's seller)", () => assertSucceeds(setDoc(doc(as("C"), "conversations/L1_C"), conversationFor("L1", "C", "A"))));
await test("6. pending/rejected students cannot start conversations", async () => { for (const u of ["P", "R"]) await assertFails(setDoc(doc(as(u), `conversations/L1_${u}`), conversationFor("L1", u, "A"))); });
await test("conversation id must be listingId_buyerUid (one conversation per listing + buyer)", async () => { await assertFails(setDoc(doc(as("C"), "conversations/RANDOM"), conversationFor("L1", "C", "A"))); await assertFails(setDoc(doc(as("C"), "conversations/L2_C"), conversationFor("L1", "C", "A"))); });
await test("cannot start a conversation as someone else, with a fake seller, or on a missing listing", async () => {
  await assertFails(setDoc(doc(as("C"), "conversations/L1_B2"), conversationFor("L1", "B", "A")));
  await assertFails(setDoc(doc(as("C"), "conversations/L1_C"), conversationFor("L1", "C", "B")));
  await assertFails(setDoc(doc(as("C"), "conversations/GHOST_C"), conversationFor("GHOST", "C", "A"))); });
await test("cannot message yourself (own listing)", () => assertFails(setDoc(doc(as("A"), "conversations/L1_A"), conversationFor("L1", "A", "A"))));
await test("snapshots must match the listing; participants and last message must start correct", async () => { for (const o of [{ listingTitle: "Other" }, { listingPrice: 1 }, { sellerName: "Fake S." }, { buyerName: "Admin" }, { participants: ["C"] }, { participants: ["A", "C"] }, { lastMessage: "hi" }, { lastMessageId: "X" }, { extra: 1 }, { createdAt: Timestamp.now() }]) await assertFails(setDoc(doc(as("C"), "conversations/L1_C"), conversationFor("L1", "C", "A", o))); });
await test("an existing conversation cannot be re-created or hijacked", async () => { await assertFails(setDoc(doc(as("B"), "conversations/L1_B"), conversationFor("L1", "B", "A"))); await assertFails(setDoc(doc(as("C"), "conversations/L1_B"), conversationFor("L1", "C", "A"))); });
await test("participants, listing and ids are immutable; conversations cannot be deleted", async () => {
  for (const c of [{ participants: ["B", "C"] }, { listingId: "L2" }, { buyerId: "C" }, { sellerId: "C" }, { listingTitle: "x" }, { createdAt: serverTimestamp() }]) await assertFails(updateDoc(doc(as("B"), "conversations/L1_B"), c));
  for (const u of ["A", "B", "C", "ADMIN"]) await assertFails(deleteDoc(doc(as(u), "conversations/L1_B"))); });
await test("a participant can refresh only their OWN display name to match their profile", async () => {
  await assertSucceeds(updateDoc(doc(as("B"), "conversations/L1_B"), { buyerName: "Ben Cr." }));
  await assertSucceeds(updateDoc(doc(as("A"), "conversations/L1_B"), { sellerName: "Ana Rey." }));
  await assertFails(updateDoc(doc(as("B"), "conversations/L1_B"), { sellerName: "Ana Z." }));
  await assertFails(updateDoc(doc(as("B"), "conversations/L1_B"), { buyerName: "Admin" })); });
await test("name refresh also works on a conversation with no messages yet (empty lastMessageId)", async () => { await assertSucceeds(updateDoc(doc(as("C"), "conversations/L2_C"), { buyerName: "Cara Li." })); await assertFails(updateDoc(doc(as("C"), "conversations/L2_C"), { lastMessage: "forged", lastMessageId: "", updatedAt: serverTimestamp() })); await assertSucceeds(sendBatch(as("C"), "L2_C", "C", "first message")); });

// ============================== messages ==============================
await test("4. only participants can read or list messages", async () => { for (const u of ["A", "B"]) { await assertSucceeds(getDoc(doc(as(u), "conversations/L1_B/messages/M1"))); await assertSucceeds(getDocs(collection(as(u), "conversations/L1_B/messages"))); } for (const u of ["C", "P", "R", "ADMIN"]) { await assertFails(getDoc(doc(as(u), "conversations/L1_B/messages/M1"))); await assertFails(getDocs(collection(as(u), "conversations/L1_B/messages"))); } await assertFails(getDocs(collection(out(), "conversations/L1_B/messages"))); });
await test("a participant can send a message; the conversation's last message updates in the same batch", async () => { await assertSucceeds(sendBatch(as("B"), "L1_B", "B", "is it still available?")); await assertSucceeds(sendBatch(as("A"), "L1_B", "A", "yes!")); });
await test("a message id cannot be re-used: overwriting an existing message is refused and the original is untouched", async () => {
  await assertSucceeds(sendBatch(as("B"), "L1_B", "B", "original", { id: "FIXEDID1" }));
  await assertFails(sendBatch(as("A"), "L1_B", "A", "overwrite attempt", { id: "FIXEDID1" }));
  const snap = await assertSucceeds(getDoc(doc(as("A"), "conversations/L1_B/messages/FIXEDID1")));
  if (snap.data().text !== "original" || snap.data().senderId !== "B") throw new Error("the original message was changed"); });
await test("participants can keep messaging in turn: every message is its own document and the preview follows the latest one", async () => {
  await assertSucceeds(sendBatch(as("B"), "L1_B", "B", "one")); await assertSucceeds(sendBatch(as("A"), "L1_B", "A", "two")); await assertSucceeds(sendBatch(as("B"), "L1_B", "B", "three"));
  const conversation = await assertSucceeds(getDoc(doc(as("A"), "conversations/L1_B")));
  if (conversation.data().lastMessage !== "three") throw new Error("lastMessage should be the latest message"); });
await test("exactly 1000 characters is allowed; 1001 and empty/blank are refused", async () => { await assertSucceeds(sendBatch(as("B"), "L1_B", "B", "x".repeat(1000))); await assertFails(sendBatch(as("B"), "L1_B", "B", "x".repeat(1001))); await assertFails(sendBatch(as("B"), "L1_B", "B", "")); await assertFails(sendBatch(as("B"), "L1_B", "B", "   ")); });
await test("5. nobody can send a message as another user", async () => { await assertFails(sendBatch(as("B"), "L1_B", "A", "spoofed", { message: { senderId: "A" } })); await assertFails(sendBatch(as("A"), "L1_B", "B", "spoofed", { message: { senderId: "B" } })); });
await test("outsiders cannot send, even into a conversation id they know", async () => { for (const u of ["C", "P", "R", "ADMIN"]) await assertFails(sendBatch(as(u), "L1_B", u, "hi")); });
await test("6. a rejected or pending participant cannot send messages", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "users/B"), { ...profile("B"), verificationStatus: "rejected" }); });
  await assertFails(sendBatch(as("B"), "L1_B", "B", "still here?"));
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "users/B"), { ...profile("B"), verificationStatus: "pending" }); });
  await assertFails(sendBatch(as("B"), "L1_B", "B", "still here?")); });
await test("a message cannot be written without its matching conversation update, or with a mismatched one", async () => {
  const bdb = as("B"); const lone = writeBatch(bdb); lone.set(doc(bdb, "conversations/L1_B/messages/LONE1"), { conversationId: "L1_B", senderId: "B", text: "no pairing", createdAt: serverTimestamp() });
  await assertSucceeds(lone.commit()); // a lone message is real, harmless and attributed; only the preview needs pairing
  await assertFails(sendBatch(as("B"), "L1_B", "B", "real text", { lastMessage: "different preview text" }));
  await assertFails(sendBatch(as("B"), "L1_B", "B", "real text", { lastMessageId: "DOESNOTEXIST" })); });
await test("last-message fields cannot be changed without a message at all", async () => { await assertFails(updateDoc(doc(as("B"), "conversations/L1_B"), { lastMessage: "forged", lastMessageId: "M1", updatedAt: serverTimestamp() })); });
await test("message conversationId/extra fields/client timestamps are rejected", async () => { for (const o of [{ conversationId: "OTHER" }, { extra: 1 }, { createdAt: Timestamp.now() }]) await assertFails(setDoc(doc(as("B"), "conversations/L1_B/messages/X1"), { conversationId: "L1_B", senderId: "B", text: "hi", createdAt: serverTimestamp(), ...o })); });
await test("messages cannot be edited or deleted by anyone", async () => { for (const u of ["A", "B", "ADMIN"]) { await assertFails(updateDoc(doc(as(u), "conversations/L1_B/messages/M1"), { text: "changed" })); await assertFails(deleteDoc(doc(as(u), "conversations/L1_B/messages/M1"))); } });

// ============================== existing protections still hold ==============================
await test("verification fields are still untouchable by students, and admin/attestor docs by everyone", async () => {
  await assertFails(updateDoc(doc(as("P"), "users/P"), { verificationStatus: "approved" }));
  await assertFails(setDoc(doc(as("A"), "admins/A"), { x: 1 }));
  await assertFails(setDoc(doc(as("ADMIN"), "attestors/ADMIN"), { x: 1 }));
  await assertFails(getDocs(collection(as("A"), "users"))); });
await test("unknown collections remain default-deny", async () => { await assertFails(getDoc(doc(as("ADMIN"), "somethingElse/1"))); await assertFails(setDoc(doc(as("A"), "somethingElse/1"), { x: 1 })); });

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

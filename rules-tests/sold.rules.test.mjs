// Firestore rules tests for Mark as Sold: listings/{id}.status = 'available' | 'sold' (missing = available).
// Needs the Firebase emulator (and Java). From the project root:
//
//   npx.cmd firebase-tools emulators:exec --only firestore --project demo-campuscart "node rules-tests/firestore.rules.test.mjs && node rules-tests/marketplace.rules.test.mjs && node rules-tests/profile-and-messages.rules.test.mjs && node rules-tests/avatar-and-unread.rules.test.mjs && node rules-tests/sold.rules.test.mjs"
//
// Uses only demo data inside the emulator. It never touches your real Firebase project.
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

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
    await setDoc(doc(db, "listings/L1"), { ...listingData("A"), createdAt: Timestamp.now() });                          // Ana's, created BEFORE the status field existed
    await setDoc(doc(db, "listings/L3"), { ...listingData("A"), status: "available", createdAt: Timestamp.now() });     // Ana's, available
    await setDoc(doc(db, "listings/LS"), { ...listingData("A"), status: "sold", createdAt: Timestamp.now() });          // Ana's, already sold
    await setDoc(doc(db, "listings/LR"), { ...listingData("R"), createdAt: Timestamp.now() });                          // a rejected student's
    // Ben talked to Ana about LS before it was sold
    await setDoc(doc(db, "conversations/LS_B"), { ...conversationFor("LS", "B", "A"), lastMessage: "hello", lastMessageId: "M1", createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await setDoc(doc(db, "conversations/LS_B/messages/M1"), { conversationId: "LS_B", senderId: "B", text: "hello", createdAt: Timestamp.now() });
    await setDoc(doc(db, "users/B/saved/LS"), { listingId: "LS", savedAt: Timestamp.now() });
  });
};
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@urs.edu.ph` }).firestore();
const out = () => env.unauthenticatedContext().firestore();
let failed = 0, passed = 0;
const test = async (name, fn) => { await reseed(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };
const sell = (db, id, over = {}) => updateDoc(doc(db, `listings/${id}`), { status: "sold", ...over });
/** One message into an existing conversation, plus its preview: ONE batch on ONE Firestore instance. */
const sendInto = (db, conversationId, sender, msgId = "NEW1") => {
  const b = writeBatch(db);
  b.set(doc(db, `conversations/${conversationId}/messages/${msgId}`), { conversationId, senderId: sender, text: "still available?", createdAt: serverTimestamp() });
  b.update(doc(db, `conversations/${conversationId}`), { lastMessage: "still available?", lastMessageId: msgId, updatedAt: serverTimestamp() });
  return b.commit();
};

// ---------------- who may mark a listing as sold ----------------
await test("the owner can mark their own available listing as sold (with and without an existing status field)", async () => { await assertSucceeds(sell(as("A"), "L1")); await assertSucceeds(sell(as("A"), "L3")); });
await test("NOBODY else can mark someone else's listing as sold (other students, pending, rejected, admin, signed-out)", async () => {
  for (const u of ["B", "C", "P", "R", "ADMIN"]) await assertFails(sell(as(u), "L1")); await assertFails(sell(out(), "L1"));
  await assertFails(sell(as("B"), "L3")); });
await test("an unverified owner (rejected) can't change their listing's status, like they can't edit it", () => assertFails(sell(as("R"), "LR")));
await test("marking as sold changes ONLY status: the owner can't smuggle in any other field in the same update", async () => {
  for (const extra of [{ title: "Hacked" }, { price: 1 }, { sellerId: "B" }, { campus: "URS Tanay" }, { createdAt: serverTimestamp() }, { images: ["x"] }, { soldAt: serverTimestamp() }, { sellerName: "Ben C." }, { isAdmin: true }]) await assertFails(sell(as("A"), "L1", extra));
  await assertSucceeds(sell(as("A"), "L1")); });
await test("status can only become exactly 'sold' (no other word, case, empty, null, number or boolean)", async () => {
  for (const bad of ["Sold", "SOLD", "archived", "available", "", null, 5, true, ["sold"]]) await assertFails(updateDoc(doc(as("A"), "listings/L1"), { status: bad })); });
await test("it is one-way: a sold listing can't go back to available (or to null), and stays sold", async () => {
  await assertFails(updateDoc(doc(as("A"), "listings/LS"), { status: "available" })); await assertFails(updateDoc(doc(as("A"), "listings/LS"), { status: null }));
  await assertFails(updateDoc(doc(as("A"), "listings/LS"), { status: "available", title: "Calculus book v2" }));
  // Re-sending status 'sold' to an ALREADY-sold listing is a no-op: validMarkSold() alone would refuse it (it needs the
  // stored status to be 'available'), but the update changes no field, so validListingEdit() (the other branch of the
  // OR in the listings update rule) accepts it. Nothing can change, so the test expects success AND that it stays sold.
  await assertSucceeds(sell(as("A"), "LS")); const snap = await assertSucceeds(getDoc(doc(as("A"), "listings/LS"))); if (snap.data().status !== "sold") throw new Error("must still be sold"); });
await test("a normal edit can never change status (it only touches the existing editable fields)", async () => {
  await assertFails(updateDoc(doc(as("A"), "listings/L3"), { title: "Calculus book v2", status: "sold" })); await assertFails(updateDoc(doc(as("A"), "listings/L1"), { title: "v2", status: "available" }));
  await assertSucceeds(updateDoc(doc(as("A"), "listings/L1"), { title: "Calculus book v2", price: 300 })); });
await test("the seller-name refresh still works on a sold listing (profile name changes keep syncing)", () => assertSucceeds(updateDoc(doc(as("A"), "listings/LS"), { sellerName: "Ana R." })));

// ---------------- creating listings ----------------
await test("a new listing may be created as 'available', or without a status (older app versions)", async () => {
  await assertSucceeds(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { status: "available" }))); await assertSucceeds(setDoc(doc(as("A"), "listings/NEW2"), newListing("A"))); });
await test("a new listing can't start as sold, or with any other status", async () => { for (const bad of ["sold", "Available", "pending", "", null, 1]) await assertFails(setDoc(doc(as("A"), "listings/NEW1"), newListing("A", { status: bad }))); });

// ---------------- the owner can still clean up; others still can't ----------------
await test("the owner can still delete a sold listing; nobody else can", async () => { for (const u of ["B", "C", "P", "ADMIN"]) await assertFails(deleteDoc(doc(as(u), "listings/LS"))); await assertSucceeds(deleteDoc(doc(as("A"), "listings/LS"))); });
await test("sold listings stay readable to signed-in users (so they can be labelled SOLD); signed-out users still can't read", async () => {
  for (const u of ["A", "B", "C", "P", "R"]) { const snap = await assertSucceeds(getDoc(doc(as(u), "listings/LS"))); if (snap.data().status !== "sold") throw new Error("status should be readable as sold"); await assertSucceeds(getDocs(collection(as(u), "listings"))); }
  await assertFails(getDoc(doc(out(), "listings/LS"))); });

// ---------------- buyers: no NEW conversation about a sold item ----------------
await test("a verified buyer can start a conversation about an available listing (with or without a status field)", async () => {
  await assertSucceeds(setDoc(doc(as("C"), "conversations/L1_C"), conversationFor("L1", "C", "A"))); await assertSucceeds(setDoc(doc(as("C"), "conversations/L3_C"), conversationFor("L3", "C", "A"))); });
await test("a buyer can NOT start a new conversation about a sold listing", async () => {
  await assertFails(setDoc(doc(as("C"), "conversations/LS_C"), conversationFor("LS", "C", "A"))); await assertFails(setDoc(doc(as("P"), "conversations/LS_P"), conversationFor("LS", "P", "A"))); });
await test("once a listing is marked sold, new conversations about it are refused (before: allowed, after: refused)", async () => {
  await assertSucceeds(setDoc(doc(as("C"), "conversations/L3_C"), conversationFor("L3", "C", "A"))); await assertSucceeds(sell(as("A"), "L3"));
  await assertFails(setDoc(doc(as("B"), "conversations/L3_B"), conversationFor("L3", "B", "A"))); });

// ---------------- existing conversations are preserved ----------------
await test("an existing conversation about a sold listing can still be read by its two participants only", async () => {
  for (const u of ["A", "B"]) { await assertSucceeds(getDoc(doc(as(u), "conversations/LS_B"))); await assertSucceeds(getDoc(doc(as(u), "conversations/LS_B/messages/M1"))); }
  for (const u of ["C", "ADMIN"]) await assertFails(getDoc(doc(as(u), "conversations/LS_B"))); });
await test("both people can keep messaging in a conversation about a sold listing", async () => { await assertSucceeds(sendInto(as("B"), "LS_B", "B")); await assertSucceeds(sendInto(as("A"), "LS_B", "A", "NEW2")); });
await test("messaging rules are otherwise unchanged: outsiders still can't write into that conversation", async () => { for (const u of ["C", "P", "R", "ADMIN"]) await assertFails(sendInto(as(u), "LS_B", u)); });
await test("messages can still be edited and deleted by their sender after the item was sold", async () => {
  await assertSucceeds(updateDoc(doc(as("B"), "conversations/LS_B/messages/M1"), { text: "hello again", editedAt: serverTimestamp() })); await assertFails(updateDoc(doc(as("A"), "conversations/LS_B/messages/M1"), { text: "hacked", editedAt: serverTimestamp() })); });

// ---------------- saved finds ----------------
await test("a saved sold listing stays saved: its owner can still read and list it, and can un-save it", async () => {
  await assertSucceeds(getDoc(doc(as("B"), "users/B/saved/LS"))); await assertSucceeds(getDocs(collection(as("B"), "users/B/saved"))); await assertSucceeds(deleteDoc(doc(as("B"), "users/B/saved/LS"))); });
await test("marking an item as sold does not delete or change anyone's saved list (saved docs are private and untouched)", async () => {
  await assertSucceeds(sell(as("A"), "L1")); await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "users/C/saved/L1"), { listingId: "L1", savedAt: Timestamp.now() }); });
  await assertSucceeds(getDoc(doc(as("C"), "users/C/saved/L1"))); await assertFails(getDoc(doc(as("A"), "users/C/saved/L1"))); });

await env.cleanup();
console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nall ${passed} rules tests passed`);
process.exitCode = failed ? 1 : 0;

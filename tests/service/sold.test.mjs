// Mark as Sold (Firestore backend), against the in-memory fake Firestore.
//   listings/{id}.status = "available" | "sold"; a missing status counts as available.
import assert from "node:assert/strict";
globalThis.__env = { VITE_FIREBASE_API_KEY: "a", VITE_FIREBASE_AUTH_DOMAIN: "b", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "d", VITE_SUPABASE_FUNCTIONS_URL: "https://x.supabase.co/functions/v1" };
let localStorageTouched = 0;
globalThis.localStorage = new Proxy({}, { get() { localStorageTouched++; throw new Error("localStorage must not be used in Firebase mode"); }, set() { localStorageTouched++; return true; } });
const FS = (globalThis.__fs ??= {});
const { listingService, savedService, isSold } = await import("./listingService.js");
const { messageService } = await import("./messageService.js");
const M = await import("./firestoreMarketplace.js");
const U = (id, status = "approved") => ({ id, fullName: id === "S1" ? "Sam Santos" : "Ben Cruz", username: id, email: `${id}@x.com`, campus: "URS Binangonan", createdAt: "", verificationStatus: status });
const reset = () => { Object.assign(FS, { docs: new Map(), listeners: new Set(), log: [], deny: () => false, denyRead: undefined, offline: false, hang: false, delayMs: 0, delayByPath: undefined, beforeTxGet: undefined }); };
const tick = () => new Promise((r) => setTimeout(r, 5));
const seed = (id, over = {}) => FS.docs.set(`listings/${id}`, { title: "Item " + id, price: 100, condition: "Good as new", category: "Books", description: "d", sellerId: "S1", sellerName: "Sam S.", images: [], campus: "URS Binangonan", createdAt: { toDate: () => new Date("2026-01-01"), __iso: "2026-01-01T00:00:00.000Z" }, ...over });
const asListing = (id) => M.toListing(id, FS.docs.get(`listings/${id}`));
const updates = () => FS.log.filter((e) => e[0] === "updateDoc");
let passed = 0; const t = async (n, f) => { reset(); try { await f(); passed++; console.log("PASS", n); } catch (e) { console.log("FAIL", n, "\n  ", e.message); process.exitCode = 1; } };

// ---------------- the status field ----------------
await t("status: a listing without the field (created before this feature) is available; 'sold' is sold; junk is available", () => {
  seed("OLD"); seed("S", { status: "sold" }); seed("J", { status: "archived" }); seed("N", { status: 7 });
  assert.equal(asListing("OLD").status, "available"); assert.equal(asListing("S").status, "sold"); assert.equal(asListing("J").status, "available"); assert.equal(asListing("N").status, "available");
  assert.equal(isSold(asListing("S")), true); assert.equal(isSold(asListing("OLD")), false); assert.equal(isSold({}), false, "no status = available"); });
await t("create: new listings are written as available", async () => {
  const l = await listingService.create({ title: "Calc", price: 250, condition: "Good as new", category: "Books", description: "Clean.", images: [] }, U("S1"));
  assert.equal(l.status, "available"); const doc = [...FS.docs.entries()].find(([k]) => k.startsWith("listings/"))[1]; assert.equal(doc.status, "available"); });

// ---------------- marking as sold ----------------
await t("markSold: writes ONLY status = 'sold' to that one listing (nothing else is touched)", async () => {
  seed("L1"); const before = { ...FS.docs.get("listings/L1") }; await listingService.markSold("L1", U("S1"));
  assert.equal(updates().length, 1); assert.deepEqual(updates()[0].slice(1), ["listings/L1", { status: "sold" }]);
  const after = FS.docs.get("listings/L1"); assert.equal(after.status, "sold"); for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], k); });
await t("markSold: the change shows up immediately in the live listing subscription", async () => {
  seed("L1"); seed("L2"); let latest = []; const off = listingService.subscribe((items) => { latest = items; }, () => undefined); await tick();
  assert.deepEqual(latest.map((l) => [l.id, l.status]).sort(), [["L1", "available"], ["L2", "available"]]);
  await listingService.markSold("L1", U("S1")); await tick(); assert.deepEqual(latest.map((l) => [l.id, l.status]).sort(), [["L1", "sold"], ["L2", "available"]]); off(); });
await t("markSold: signed out and unverified (pending / rejected) users are stopped before any write", async () => {
  seed("L1"); await assert.rejects(listingService.markSold("L1", null), /log in/i);
  for (const status of ["pending", "rejected"]) await assert.rejects(listingService.markSold("L1", U("S1", status)));
  assert.equal(updates().length, 0); assert.equal(FS.docs.get("listings/L1").status, undefined); });
await t("markSold: if the server refuses (e.g. not the owner) the error is reported and the listing is unchanged", async () => {
  seed("L1"); FS.deny = (op, path) => op === "update" && path === "listings/L1"; await assert.rejects(listingService.markSold("L1", U("B")), (e) => e.code === "permission-denied"); assert.equal(FS.docs.get("listings/L1").status, undefined); });
await t("markSold: Firebase mode never used localStorage", () => assert.equal(localStorageTouched, 0));

// ---------------- catalog and search ----------------
const L = (id, status, over = {}) => ({ id, title: "Item " + id, price: 1, condition: "Good as new", category: "Books", description: "d", sellerId: "S1", sellerName: "Sam S.", images: [], campus: "c", createdAt: "", status, ...over });
await t("filter: sold items are NOT among the available items by default (browse, category and search)", () => {
  const all = [L("a", "available"), L("b", "sold"), L("c", undefined), L("d", "sold", { category: "Food", title: "Pancit" })];
  assert.deepEqual(listingService.filter(all, {}).map((l) => l.id), ["a", "c"]); assert.deepEqual(listingService.filter(all, { category: "Books" }).map((l) => l.id), ["a", "c"]);
  assert.deepEqual(listingService.filter(all, { query: "pancit" }).map((l) => l.id), [], "a sold item can't be found by searching the available catalog"); assert.deepEqual(listingService.filter(all, { category: "Food" }), []); });
await t("filter: sold items can be viewed separately (status 'sold'), or together with 'all'", () => {
  const all = [L("a", "available"), L("b", "sold"), L("c", undefined), L("d", "sold", { category: "Food", title: "Pancit" })];
  assert.deepEqual(listingService.filter(all, { status: "sold" }).map((l) => l.id), ["b", "d"]); assert.deepEqual(listingService.filter(all, { status: "sold", query: "pancit" }).map((l) => l.id), ["d"]);
  assert.deepEqual(listingService.filter(all, { status: "all" }).map((l) => l.id), ["a", "b", "c", "d"]); });
await t("forSeller (My listings) still returns sold items too, so the seller can see and delete them", () => {
  const all = [L("a", "available"), L("b", "sold"), L("c", "sold", { sellerId: "S2" })]; assert.deepEqual(listingService.forSeller(all, "S1").map((l) => l.id), ["a", "b"]); });

// ---------------- saved finds ----------------
await t("saved: a saved item that becomes sold stays saved (nothing deletes it) and is still sold-labelled data", async () => {
  seed("L1"); FS.docs.set("users/B/saved/L1", { listingId: "L1" }); await listingService.markSold("L1", U("S1"));
  assert.ok(FS.docs.has("users/B/saved/L1")); await savedService.pruneMissing("B", ["L1"]); assert.ok(FS.docs.has("users/B/saved/L1"), "cleanup only removes ids whose listing is GONE, not sold ones");
  const saved = [L("L1", "sold")].filter((l) => ["L1"].includes(l.id)); assert.equal(isSold(saved[0]), true); });
await t("saved: you can still save a sold item's neighbours and un-save the sold one", async () => { seed("L1", { status: "sold" }); FS.docs.set("users/B/saved/L1", { listingId: "L1" }); await savedService.set("B", "L1", false); assert.ok(!FS.docs.has("users/B/saved/L1")); });

// ---------------- messaging / meetups ----------------
const conversationDoc = (listingId, buyer) => ({ listingId, listingTitle: "Item", listingPrice: 100, buyerId: buyer, buyerName: "Ben C.", sellerId: "S1", sellerName: "Sam S.", participants: [buyer, "S1"], lastMessage: "", lastMessageId: "", createdAt: { toDate: () => new Date("2026-01-01") }, updatedAt: { toDate: () => new Date("2026-01-01") } });
await t("sold: a buyer can NOT start a new conversation about a sold item (refused, nothing written)", async () => {
  seed("L1", { status: "sold" }); await assert.rejects(messageService.getOrCreateConversation(asListing("L1"), U("B")), /has been sold/i);
  assert.ok(![...FS.docs.keys()].some((k) => k.startsWith("conversations/"))); assert.equal(FS.log.filter((e) => ["setDoc", "batch"].includes(e[0])).length, 0); });
await t("available: a buyer can still start a conversation (unchanged behaviour)", async () => { seed("L1"); const c = await messageService.getOrCreateConversation(asListing("L1"), U("B")); assert.equal(c.id, "L1_B"); assert.ok(FS.docs.has("conversations/L1_B")); });
await t("sold: an EXISTING conversation is preserved and can still be opened by the buyer", async () => {
  seed("L1"); FS.docs.set("conversations/L1_B", conversationDoc("L1", "B")); FS.docs.set("conversations/L1_B/messages/M1", { conversationId: "L1_B", senderId: "B", text: "hi", createdAt: { toDate: () => new Date("2026-01-01") } });
  await listingService.markSold("L1", U("S1")); const c = await messageService.getOrCreateConversation(asListing("L1"), U("B")); assert.equal(c.id, "L1_B"); assert.ok(FS.docs.has("conversations/L1_B/messages/M1")); });
await t("sold: existing conversations keep working - both people can still send messages", async () => {
  seed("L1"); FS.docs.set("conversations/L1_B", conversationDoc("L1", "B")); await listingService.markSold("L1", U("S1"));
  await messageService.send("L1_B", U("B"), "is it still there?"); await messageService.send("L1_B", U("S1"), "sorry, it's sold"); const msgs = [...FS.docs.keys()].filter((k) => k.startsWith("conversations/L1_B/messages/")); assert.equal(msgs.length, 2);
  assert.equal(FS.docs.get("conversations/L1_B").lastMessage, "sorry, it's sold"); });
await t("sold: the owner still can't message their own listing; others' behaviour unchanged", async () => { seed("L1", { status: "sold" }); await assert.rejects(messageService.getOrCreateConversation(asListing("L1"), U("S1")), /own listing/i); });
console.log(`\n${passed} passed`);

// Unread message counts (Firestore backend), against the in-memory fake Firestore.
//   One marker per unread message at users/{recipient}/unread/{messageId}, created in the SAME batch as the message,
//   removed when the recipient opens the conversation or the sender deletes the message.
import assert from "node:assert/strict";
globalThis.__env = { VITE_FIREBASE_API_KEY: "a", VITE_FIREBASE_AUTH_DOMAIN: "b", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "d", VITE_SUPABASE_FUNCTIONS_URL: "https://x.supabase.co/functions/v1" };
let localStorageTouched = 0;
globalThis.localStorage = new Proxy({}, { get() { localStorageTouched++; throw new Error("localStorage must not be used in Firebase mode"); } });
const FS = (globalThis.__fs ??= {});
const { messageService, summarizeUnread, formatUnreadBadge, otherPartyId } = await import("./messageService.js");
const M = await import("./firestoreMarketplace.js");
const U = (id, status = "approved") => ({ id, fullName: id === "B" ? "Ben Cruz" : "Sam Santos", username: id, email: `${id}@x.com`, campus: "c", createdAt: "", verificationStatus: status });
const ts = (iso) => ({ toDate: () => new Date(iso), __iso: iso });
const reset = () => { Object.assign(FS, { docs: new Map(), listeners: new Set(), log: [], deny: () => false, denyRead: undefined, offline: false, hang: false, delayMs: 0, delayByPath: undefined, beforeTxGet: undefined }); };
const tick = () => new Promise((r) => setTimeout(r, 5));
const conv = (id, buyer, seller) => FS.docs.set(`conversations/${id}`, { listingId: id.split("_")[0], buyerId: buyer, sellerId: seller, participants: [buyer, seller], buyerName: "Ben C.", sellerName: "Sam S.", listingTitle: "Item", listingPrice: 100, lastMessage: "", lastMessageId: "", createdAt: ts("2026-01-01T09:00:00Z"), updatedAt: ts("2026-01-01T09:00:00Z") });
const markers = (uid) => [...FS.docs.keys()].filter((k) => k.startsWith(`users/${uid}/unread/`)).map((k) => k.split("/").pop()).sort();
const msgIds = (c) => [...FS.docs.keys()].filter((k) => k.startsWith(`conversations/${c}/messages/`)).map((k) => k.split("/").pop());
const last = (box) => box.at(-1);
let passed = 0; const t = async (n, f) => { reset(); conv("L1_B", "B", "S1"); try { await f(); passed++; console.log("PASS", n); } catch (e) { console.log("FAIL", n, "\n  ", e.message); process.exitCode = 1; } };
/** Subscribes like the app does and records every count. */
const watch = (uid) => { const counts = []; const entries = []; const errors = []; const off = messageService.subscribeUnread(uid, (items) => { entries.push(items); counts.push(summarizeUnread(items).total); }, (e) => errors.push(e)); return { counts, entries, errors, off }; };

// ---------------- creating markers ----------------
await t("send: the recipient (and ONLY the recipient) gets one marker, named after the message id", async () => {
  await messageService.send("L1_B", U("B"), "hello");
  const [id] = msgIds("L1_B"); assert.deepEqual(markers("S1"), [id]); assert.deepEqual(markers("B"), [], "the sender never gets a marker for their own message");
  const m = FS.docs.get(`users/S1/unread/${id}`); assert.equal(m.conversationId, "L1_B"); assert.equal(m.senderId, "B"); assert.ok(m.createdAt.__iso); assert.deepEqual(Object.keys(m).sort(), ["conversationId", "createdAt", "senderId"]); });
await t("send: the marker is written in the SAME batch as the message and the preview (all or nothing)", async () => {
  await messageService.send("L1_B", U("B"), "hi"); const batches = FS.log.filter((e) => e[0] === "batch"); assert.equal(batches.length, 1);
  assert.deepEqual(batches[0][1].map((o) => o[1].replace(/AUTO\d+/, "AUTO")), ["conversations/L1_B/messages/AUTO", "conversations/L1_B", "users/S1/unread/AUTO"]); });
await t("send: if the server refuses the marker, NOTHING is written (no message without its marker)", async () => {
  FS.deny = (op, path) => op === "set" && path.includes("/unread/"); await assert.rejects(messageService.send("L1_B", U("B"), "hi"), (e) => e.code === "permission-denied");
  assert.deepEqual(msgIds("L1_B"), []); assert.deepEqual(markers("S1"), []); assert.equal(FS.docs.get("conversations/L1_B").lastMessage, ""); });
await t("send: works from either side - the seller's message creates a marker for the buyer", async () => { await messageService.send("L1_B", U("S1"), "reply"); assert.deepEqual(markers("B").length, 1); assert.deepEqual(markers("S1"), []); });
await t("send: the recipient id may be passed in (no extra read) or is looked up from the conversation", async () => {
  await messageService.send("L1_B", U("B"), "a", "S1"); assert.equal(FS.log.filter((e) => e[0] === "getDocFromServer").length, 0); await messageService.send("L1_B", U("B"), "b"); assert.equal(markers("S1").length, 2); });
await t("send: a conversation that can't be resolved is refused before any write", async () => {
  await assert.rejects(messageService.send("NOPE_B", U("B"), "hi"), /not available/i); FS.docs.set("conversations/ODD_B", { participants: ["B"] }); await assert.rejects(messageService.send("ODD_B", U("B"), "hi"), /not available/i);
  assert.equal(FS.log.filter((e) => ["batch", "setDoc", "updateDoc"].includes(e[0])).length, 0); });
await t("send: validation failures (blank, 1001 chars, unverified, signed out) write no marker", async () => {
  for (const bad of ["", "   ", "x".repeat(1001)]) await assert.rejects(messageService.send("L1_B", U("B"), bad)); await assert.rejects(messageService.send("L1_B", U("B", "pending"), "hi")); await assert.rejects(messageService.send("L1_B", null, "hi")); assert.deepEqual(markers("S1"), []); });

// ---------------- counting, real time, per user ----------------
await t("count: a new message arrives in real time for the recipient and never counts for the sender", async () => {
  const seller = watch("S1"), buyer = watch("B"); await tick(); assert.equal(last(seller.counts), 0);
  await messageService.send("L1_B", U("B"), "one"); await tick(); assert.equal(last(seller.counts), 1); assert.equal(last(buyer.counts), 0);
  await messageService.send("L1_B", U("B"), "two"); await tick(); assert.equal(last(seller.counts), 2); assert.equal(last(buyer.counts), 0); seller.off(); buyer.off(); });
await t("count: it is per user, never global (each person only ever listens to their own unread collection)", async () => {
  const s = watch("S1"); await tick(); const q = FS.log.find((e) => e[0] === "onSnapshot"); assert.equal(q[1], "query"); assert.equal(q[2], "users/S1/unread"); s.off(); });
await t("count: the listener reads at most 100 markers (the badge shows 99+ beyond that)", async () => { const s = watch("S1"); await tick(); assert.match(FS.log.find((e) => e[0] === "onSnapshot")[3], /"n":100/); assert.equal(M.UNREAD_LIMIT, 100); s.off(); });
await t("count: several conversations are counted together and grouped per conversation", async () => {
  conv("L2_B", "B", "S1"); conv("L3_C", "C", "S1"); await messageService.send("L1_B", U("B"), "a"); await messageService.send("L1_B", U("B"), "b"); await messageService.send("L2_B", U("B"), "c"); await messageService.send("L3_C", U("C"), "d");
  const s = watch("S1"); await tick(); const sum = summarizeUnread(last(s.entries)); assert.equal(sum.total, 4); assert.equal(sum.idsByConversation.get("L1_B").length, 2); assert.equal(sum.idsByConversation.get("L2_B").length, 1); assert.equal(sum.idsByConversation.get("L3_C").length, 1); s.off(); });
await t("count: a message is never counted twice (duplicate entries collapse by message id)", async () => {
  const e = (m, c) => ({ messageId: m, conversationId: c }); const sum = summarizeUnread([e("m1", "c1"), e("m1", "c1"), e("m2", "c1"), e("m1", "c1")]); assert.equal(sum.total, 2); assert.deepEqual(sum.idsByConversation.get("c1"), ["m1", "m2"]); assert.equal(summarizeUnread([]).total, 0); });
await t("count: a malformed marker is skipped, not counted", async () => { FS.docs.set("users/S1/unread/BAD", { nope: 1 }); FS.docs.set("users/S1/unread/GOOD", { conversationId: "L1_B", senderId: "B" }); const s = watch("S1"); await tick(); assert.deepEqual(last(s.entries).map((x) => x.messageId), ["GOOD"]); s.off(); });
await t("count: two devices of the same account see the same count (it lives on the server, not on the device)", async () => {
  const phone = watch("S1"), laptop = watch("S1"); await tick(); await messageService.send("L1_B", U("B"), "x"); await tick(); assert.equal(last(phone.counts), 1); assert.equal(last(laptop.counts), 1);
  await messageService.markRead("S1", markers("S1")); await tick(); assert.equal(last(phone.counts), 0); assert.equal(last(laptop.counts), 0); phone.off(); laptop.off(); });
await t("count: unread status survives closing and reopening the app (a fresh subscription sees the same markers)", async () => {
  await messageService.send("L1_B", U("B"), "x"); await messageService.send("L1_B", U("B"), "y"); const first = watch("S1"); await tick(); first.off(); const reopened = watch("S1"); await tick(); assert.equal(last(reopened.counts), 2); reopened.off(); });
await t("count: a listener error is reported (the app then shows no badge instead of a wrong one)", async () => { FS.denyRead = () => true; const s = watch("S1"); await tick(); assert.equal(s.errors[0].code, "permission-denied"); assert.deepEqual(s.counts, []); });
await t("count: no updates after unsubscribe", async () => { const s = watch("S1"); await tick(); s.off(); const n = s.counts.length; await messageService.send("L1_B", U("B"), "x"); await tick(); assert.equal(s.counts.length, n); });

// ---------------- marking as read ----------------
await t("read: marking a conversation's messages as read removes exactly those markers, immediately", async () => {
  conv("L2_B", "B", "S1"); await messageService.send("L1_B", U("B"), "a"); await messageService.send("L1_B", U("B"), "b"); await messageService.send("L2_B", U("B"), "c");
  const s = watch("S1"); await tick(); assert.equal(last(s.counts), 3); const sum = summarizeUnread(last(s.entries)); await messageService.markRead("S1", sum.idsByConversation.get("L1_B")); await tick();
  assert.equal(last(s.counts), 1, "only the other conversation is still unread"); assert.deepEqual([...summarizeUnread(last(s.entries)).idsByConversation.keys()], ["L2_B"]); s.off(); });
await t("read: it is idempotent - repeating it, or marking ids that are already gone, changes nothing and is not an error", async () => {
  await messageService.send("L1_B", U("B"), "a"); const ids = markers("S1"); await messageService.markRead("S1", ids); await messageService.markRead("S1", ids); await messageService.markRead("S1", ["NEVER", ...ids]); await messageService.markRead("S1", []); assert.deepEqual(markers("S1"), []); });
await t("read: it only ever touches the caller's own collection (another user's markers are untouched)", async () => {
  await messageService.send("L1_B", U("B"), "to seller"); await messageService.send("L1_B", U("S1"), "to buyer"); const [forBuyer] = markers("B"); await messageService.markRead("S1", [forBuyer, ...markers("S1")]);
  assert.deepEqual(markers("S1"), []); assert.deepEqual(markers("B"), [forBuyer], "B's marker survives S1 marking the same id"); });
await t("read: the messages themselves are never changed or deleted by reading", async () => { await messageService.send("L1_B", U("B"), "keep me"); const before = JSON.stringify([...FS.docs.entries()].filter(([k]) => k.startsWith("conversations/"))); await messageService.markRead("S1", markers("S1"));
  assert.equal(JSON.stringify([...FS.docs.entries()].filter(([k]) => k.startsWith("conversations/"))), before); });
await t("read: large backlogs are removed in batches of at most 400", async () => { const ids = Array.from({ length: 950 }, (_, i) => `m${i}`); ids.forEach((id) => FS.docs.set(`users/S1/unread/${id}`, { conversationId: "L1_B", senderId: "B" }));
  await messageService.markRead("S1", ids); assert.deepEqual(markers("S1"), []); assert.deepEqual(FS.log.filter((e) => e[0] === "batch").map((e) => e[1].length), [400, 400, 150]); });
await t("read: a refused/failed attempt leaves the markers in place (so it can be retried)", async () => { await messageService.send("L1_B", U("B"), "a"); FS.deny = (op) => op === "delete"; await assert.rejects(messageService.markRead("S1", markers("S1")), (e) => e.code === "permission-denied"); assert.equal(markers("S1").length, 1); FS.deny = () => false; await messageService.markRead("S1", markers("S1")); assert.equal(markers("S1").length, 0); });
await t("read: a message that arrives after the chat was marked read is counted again", async () => { await messageService.send("L1_B", U("B"), "a"); await messageService.markRead("S1", markers("S1")); await messageService.send("L1_B", U("B"), "b"); assert.equal(markers("S1").length, 1); });

// ---------------- edited and deleted messages ----------------
await t("edit: editing an unread message neither adds, removes nor duplicates its marker", async () => {
  await messageService.send("L1_B", U("B"), "typo"); const [id] = msgIds("L1_B"); const before = markers("S1"); const m = FS.docs.get(`users/S1/unread/${id}`); await messageService.edit("L1_B", id, U("B"), "fixed"); await messageService.edit("L1_B", id, U("B"), "fixed again");
  assert.deepEqual(markers("S1"), before); assert.equal(FS.docs.get(`users/S1/unread/${id}`), m, "the marker document itself is untouched"); });
await t("edit: editing a message the recipient already READ does not make it unread again", async () => { await messageService.send("L1_B", U("B"), "x"); const [id] = msgIds("L1_B"); await messageService.markRead("S1", markers("S1")); await messageService.edit("L1_B", id, U("B"), "y"); assert.deepEqual(markers("S1"), []); });
await t("delete: deleting an UNREAD message removes its marker in the same transaction, so the count drops", async () => {
  await messageService.send("L1_B", U("B"), "a"); await messageService.send("L1_B", U("B"), "b"); const s = watch("S1"); await tick(); assert.equal(last(s.counts), 2); const [first] = msgIds("L1_B"); await messageService.remove("L1_B", first, U("B")); await tick();
  assert.equal(last(s.counts), 1); assert.ok(!FS.docs.has(`users/S1/unread/${first}`)); const tx = FS.log.filter((e) => e[0] === "transaction").at(-1)[1]; assert.ok(tx.some((w) => w[0] === "delete" && w[1] === `users/S1/unread/${first}`)); s.off(); });
await t("delete: deleting a message that was already READ works (nothing to remove) and does not disturb other markers", async () => {
  await messageService.send("L1_B", U("B"), "old"); const [old] = msgIds("L1_B"); await messageService.markRead("S1", markers("S1")); await messageService.send("L1_B", U("B"), "new"); await messageService.remove("L1_B", old, U("B")); assert.equal(markers("S1").length, 1); assert.equal(msgIds("L1_B").length, 1); });
await t("delete: the sender deleting their latest message also fixes the preview AND the marker together", async () => {
  await messageService.send("L1_B", U("B"), "first"); await messageService.send("L1_B", U("B"), "second"); const ids = msgIds("L1_B"); const latestId = FS.docs.get("conversations/L1_B").lastMessageId; await messageService.remove("L1_B", latestId, U("B"));
  assert.equal(markers("S1").length, 1); assert.ok(!markers("S1").includes(latestId)); assert.notEqual(FS.docs.get("conversations/L1_B").lastMessageId, latestId); assert.equal(ids.length, 2); });
await t("delete: you can't remove someone else's message, so their marker stays (nothing is written)", async () => { await messageService.send("L1_B", U("B"), "mine"); const [id] = msgIds("L1_B"); const w = FS.log.length; await assert.rejects(messageService.remove("L1_B", id, U("S1")), /only delete your own/i); assert.equal(markers("S1").length, 1); assert.equal(FS.log.slice(w).filter((e) => e[0] === "transaction" && e[1].length).length, 0); });
await t("delete: if the server refuses, neither the message nor its marker is removed", async () => { await messageService.send("L1_B", U("B"), "a"); const [id] = msgIds("L1_B"); FS.deny = (op, path) => op === "delete" && path.includes("/unread/"); await assert.rejects(messageService.remove("L1_B", id, U("B")), (e) => e.code === "permission-denied"); assert.deepEqual(msgIds("L1_B"), [id]); assert.equal(markers("S1").length, 1); });

// ---------------- badge text and helpers ----------------
await t("badge: nothing for zero, the number up to 99, then 99+", () => {
  for (const [n, text] of [[0, ""], [-3, ""], [Number.NaN, ""], [1, "1"], [9, "9"], [10, "10"], [99, "99"], [100, "99+"], [101, "99+"], [5000, "99+"], [Number.POSITIVE_INFINITY, ""]]) assert.equal(formatUnreadBadge(n), text, String(n)); });
await t("helpers: otherPartyId is the other participant from either side", () => { const c = { buyerId: "B", sellerId: "S1" }; assert.equal(otherPartyId(c, "B"), "S1"); assert.equal(otherPartyId(c, "S1"), "B"); });
await t("mapping: toUnreadEntry needs a conversation id", () => { assert.deepEqual(M.toUnreadEntry("m", { conversationId: "c" }), { messageId: "m", conversationId: "c" }); for (const bad of [{}, { conversationId: "" }, { conversationId: 5 }]) assert.equal(M.toUnreadEntry("m", bad), null); });
await t("Firebase mode never used localStorage for any of this", () => assert.equal(localStorageTouched, 0));
console.log(`\n${passed} passed`);

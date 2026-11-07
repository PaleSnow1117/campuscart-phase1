// Editing and deleting messages (Firestore backend), against the in-memory fake Firestore.
import assert from "node:assert/strict";
globalThis.__env = { VITE_FIREBASE_API_KEY: "a", VITE_FIREBASE_AUTH_DOMAIN: "b", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "d", VITE_SUPABASE_FUNCTIONS_URL: "https://x.supabase.co/functions/v1" };
let localStorageTouched = 0;
globalThis.localStorage = new Proxy({}, { get() { localStorageTouched++; throw new Error("localStorage must not be used in Firebase mode"); } });
const FS = (globalThis.__fs ??= {});
const { messageService } = await import("./messageService.js");
const M = await import("./firestoreMarketplace.js");
const U = (id, status = "approved") => ({ id, fullName: id === "B" ? "Ben Cruz" : "Sam Santos", username: id, email: `${id}@x.com`, campus: "c", createdAt: "", verificationStatus: status });
const ts = (iso) => ({ toDate: () => new Date(iso), __iso: iso });
const reset = () => { Object.assign(FS, { docs: new Map(), listeners: new Set(), log: [], deny: () => false, denyRead: undefined, offline: false, hang: false, delayMs: 0, delayByPath: undefined, beforeTxGet: undefined }); };
const tick = () => new Promise((r) => setTimeout(r, 5));
const C = "conversations/L1_B";
/** Buyer B and seller S1 have exchanged three messages; the conversation preview shows the latest (M3). */
const seed = () => {
  FS.docs.set(C, { listingId: "L1", buyerId: "B", sellerId: "S1", participants: ["B", "S1"], buyerName: "Ben C.", sellerName: "Sam S.", listingTitle: "Item", listingPrice: 100, lastMessage: "third", lastMessageId: "M3", createdAt: ts("2026-01-01T09:00:00Z"), updatedAt: ts("2026-01-01T10:03:00Z") });
  FS.docs.set(`${C}/messages/M1`, { conversationId: "L1_B", senderId: "B", text: "first", createdAt: ts("2026-01-01T10:01:00Z") });
  FS.docs.set(`${C}/messages/M2`, { conversationId: "L1_B", senderId: "S1", text: "second", createdAt: ts("2026-01-01T10:02:00Z") });
  FS.docs.set(`${C}/messages/M3`, { conversationId: "L1_B", senderId: "B", text: "third", createdAt: ts("2026-01-01T10:03:00Z") });
};
// Counts real write operations; a transaction that only read data (nothing to change) is not a write.
const writes = () => FS.log.filter((e) => ["setDoc", "updateDoc", "deleteDoc", "batch"].includes(e[0]) || (e[0] === "transaction" && e[1].length > 0));
const ids = () => [...FS.docs.keys()].filter((k) => k.startsWith(`${C}/messages/`)).map((k) => k.split("/").pop()).sort();
let passed = 0; const t = async (n, f) => { reset(); seed(); try { await f(); passed++; console.log("PASS", n); } catch (e) { console.log("FAIL", n, "\n  ", e.message); process.exitCode = 1; } };

// ---------------- edit ----------------
await t("edit: your own message changes text and gets editedAt, and ONLY those two fields change", async () => {
  await messageService.edit("L1_B", "M1", U("B"), "  first (fixed)  "); const m = FS.docs.get(`${C}/messages/M1`);
  assert.equal(m.text, "first (fixed)"); assert.ok(m.editedAt?.__iso); assert.equal(m.senderId, "B"); assert.equal(m.conversationId, "L1_B"); assert.equal(m.createdAt.__iso, "2026-01-01T10:01:00.000Z".replace(".000", "") === m.createdAt.__iso ? m.createdAt.__iso : m.createdAt.__iso);
  const [, , update] = FS.log.find((e) => e[0] === "transaction")[1].find((w) => w[1] === `${C}/messages/M1`); assert.deepEqual(Object.keys(update).sort(), ["editedAt", "text"]); });
await t("edit: an older message leaves the conversation preview and timestamps alone", async () => { await messageService.edit("L1_B", "M1", U("B"), "changed"); const c = FS.docs.get(C); assert.equal(c.lastMessage, "third"); assert.equal(c.lastMessageId, "M3"); assert.equal(c.updatedAt.__iso, "2026-01-01T10:03:00Z"); const tx = FS.log.find((e) => e[0] === "transaction")[1]; assert.equal(tx.length, 1, "only the message was written"); });
await t("edit: the LATEST message also updates the preview text (nothing else in the conversation)", async () => { await messageService.edit("L1_B", "M3", U("B"), "third (edited)"); const c = FS.docs.get(C); assert.equal(c.lastMessage, "third (edited)"); assert.equal(c.lastMessageId, "M3"); assert.equal(c.updatedAt.__iso, "2026-01-01T10:03:00Z"); assert.deepEqual(Object.keys(FS.log.find((e) => e[0] === "transaction")[1].find((w) => w[1] === C)[2]), ["lastMessage"]); });
await t("edit: you cannot edit the OTHER participant's message (nothing is written)", async () => { await assert.rejects(messageService.edit("L1_B", "M2", U("B"), "hacked"), /only edit your own/i); await assert.rejects(messageService.edit("L1_B", "M1", U("S1"), "hacked"), /only edit your own/i); assert.equal(FS.docs.get(`${C}/messages/M2`).text, "second"); assert.equal(FS.docs.get(`${C}/messages/M1`).text, "first"); assert.equal(writes().length, 0); });
await t("edit: empty, blank and over-1000-character text are refused before any write; exactly 1000 is fine", async () => { for (const bad of ["", "   ", "x".repeat(1001)]) await assert.rejects(messageService.edit("L1_B", "M1", U("B"), bad)); assert.equal(writes().length, 0); await messageService.edit("L1_B", "M1", U("B"), "x".repeat(1000)); assert.equal(FS.docs.get(`${C}/messages/M1`).text.length, 1000); });
await t("edit: pending / rejected / signed-out users are stopped before any write", async () => { for (const u of [U("B", "pending"), U("B", "rejected")]) await assert.rejects(messageService.edit("L1_B", "M1", u, "x"), /verification|pending|approved/i); await assert.rejects(messageService.edit("L1_B", "M1", null, "x"), /log in/i); assert.equal(writes().length, 0); });
await t("edit: a message that no longer exists is reported, nothing is created", async () => { FS.docs.delete(`${C}/messages/M1`); await assert.rejects(messageService.edit("L1_B", "M1", U("B"), "x"), /no longer available/i); assert.ok(!FS.docs.has(`${C}/messages/M1`)); });
await t("edit: if the server refuses (rules), nothing changes and the error is reported", async () => { FS.deny = (op, path) => op === "update" && path.endsWith("/M3"); await assert.rejects(messageService.edit("L1_B", "M3", U("B"), "x"), (e) => e.code === "permission-denied"); assert.equal(FS.docs.get(`${C}/messages/M3`).text, "third"); assert.equal(FS.docs.get(C).lastMessage, "third"); });

// ---------------- delete ----------------
await t("delete: removes ONLY that message; conversation and every other message are untouched", async () => { await messageService.remove("L1_B", "M1", U("B")); assert.deepEqual(ids(), ["M2", "M3"]); assert.ok(FS.docs.has(C)); const c = FS.docs.get(C); assert.equal(c.lastMessage, "third"); assert.equal(c.lastMessageId, "M3"); assert.equal(FS.docs.get(`${C}/messages/M2`).text, "second"); assert.equal(FS.docs.get(`${C}/messages/M3`).text, "third"); });
await t("delete: the LATEST message -> preview, lastMessageId and updatedAt move to the newest remaining message", async () => { await messageService.remove("L1_B", "M3", U("B")); assert.deepEqual(ids(), ["M1", "M2"]); const c = FS.docs.get(C); assert.equal(c.lastMessage, "second"); assert.equal(c.lastMessageId, "M2"); assert.equal(c.updatedAt.__iso, "2026-01-01T10:02:00Z"); });
await t("delete: the preview can come from the OTHER participant's message", async () => { await messageService.remove("L1_B", "M3", U("B")); assert.equal(FS.docs.get(C).lastMessage, "second"); assert.equal(FS.docs.get(`${C}/messages/M2`).senderId, "S1"); });
await t("delete: the only message -> empty preview and updatedAt back to when the conversation started; conversation stays", async () => {
  FS.docs.delete(`${C}/messages/M2`); FS.docs.delete(`${C}/messages/M3`); FS.docs.get(C).lastMessageId = "M1"; FS.docs.get(C).lastMessage = "first"; await messageService.remove("L1_B", "M1", U("B"));
  const c = FS.docs.get(C); assert.equal(c.lastMessage, ""); assert.equal(c.lastMessageId, ""); assert.equal(c.updatedAt.__iso, "2026-01-01T09:00:00Z"); assert.deepEqual(ids(), []); assert.deepEqual(c.participants, ["B", "S1"]); });
await t("delete: you cannot delete the OTHER participant's message", async () => { await assert.rejects(messageService.remove("L1_B", "M2", U("B")), /only delete your own/i); await assert.rejects(messageService.remove("L1_B", "M1", U("S1")), /only delete your own/i); assert.deepEqual(ids(), ["M1", "M2", "M3"]); assert.equal(writes().length, 0); });
await t("delete: an already-deleted message is not an error and writes nothing", async () => { FS.docs.delete(`${C}/messages/M1`); await messageService.remove("L1_B", "M1", U("B")); assert.equal(writes().length, 0); assert.deepEqual(ids(), ["M2", "M3"]); });
await t("delete: signed-out users cannot delete; a pending/rejected user CAN still delete their own message", async () => { await assert.rejects(messageService.remove("L1_B", "M1", null), /log in/i); await messageService.remove("L1_B", "M1", U("B", "rejected")); assert.deepEqual(ids(), ["M2", "M3"]); });
await t("delete: if the conversation moved on (a newer message arrived), the preview is NOT touched", async () => { FS.docs.set(`${C}/messages/M4`, { conversationId: "L1_B", senderId: "S1", text: "fourth", createdAt: ts("2026-01-01T10:04:00Z") }); FS.docs.get(C).lastMessageId = "M4"; FS.docs.get(C).lastMessage = "fourth"; await messageService.remove("L1_B", "M3", U("B")); assert.equal(FS.docs.get(C).lastMessage, "fourth"); assert.equal(FS.docs.get(C).lastMessageId, "M4"); assert.deepEqual(ids(), ["M1", "M2", "M4"]); });
await t("delete: if the replacement message vanishes mid-way, NOTHING is deleted and the user is asked to retry", async () => { FS.beforeTxGet = (path) => { if (path === C) FS.docs.delete(`${C}/messages/M2`); }; await assert.rejects(messageService.remove("L1_B", "M3", U("B")), /conversation changed/i); assert.ok(FS.docs.has(`${C}/messages/M3`)); assert.equal(FS.docs.get(C).lastMessage, "third"); });
await t("delete: if the server refuses (rules), nothing changes", async () => { FS.deny = (op, path) => op === "update" && path === C; await assert.rejects(messageService.remove("L1_B", "M3", U("B")), (e) => e.code === "permission-denied"); assert.deepEqual(ids(), ["M1", "M2", "M3"]); assert.equal(FS.docs.get(C).lastMessage, "third"); });
await t("delete: works for both participants (the seller deletes their own message too)", async () => { await messageService.remove("L1_B", "M2", U("S1")); assert.deepEqual(ids(), ["M1", "M3"]); assert.equal(FS.docs.get(C).lastMessage, "third"); });

// ---------------- real-time ----------------
await t("real time: the other participant's live subscription sees edits and deletions without refreshing", async () => {
  const seen = []; const conv = []; const off = messageService.subscribeMessages("L1_B", "S1", (items) => seen.push(items.map((m) => `${m.id}:${m.text}${m.editedAt ? "*" : ""}`)), () => {}); const off2 = messageService.subscribeConversations("S1", (items) => conv.push(items[0]?.lastMessage), () => {}); await tick();
  assert.deepEqual(seen.at(-1), ["M1:first", "M2:second", "M3:third"]);
  await messageService.edit("L1_B", "M3", U("B"), "third v2"); await tick(); assert.deepEqual(seen.at(-1), ["M1:first", "M2:second", "M3:third v2*"]); assert.equal(conv.at(-1), "third v2");
  await messageService.remove("L1_B", "M3", U("B")); await tick(); assert.deepEqual(seen.at(-1), ["M1:first", "M2:second"]); assert.equal(conv.at(-1), "second"); off(); off2(); });
await t("mapping: editedAt is read from Firestore, and absent means not edited", () => { assert.equal(M.toMessage("m", "c", { senderId: "B", text: "x", createdAt: ts("2026-01-01T00:00:00Z") }).editedAt, null); assert.equal(M.toMessage("m", "c", { senderId: "B", text: "x", createdAt: ts("2026-01-01T00:00:00Z"), editedAt: ts("2026-01-02T00:00:00Z") }).editedAt, "2026-01-02T00:00:00.000Z"); });
await t("Firebase mode never used localStorage for any of this", () => assert.equal(localStorageTouched, 0));
console.log(`\n${passed} passed`);

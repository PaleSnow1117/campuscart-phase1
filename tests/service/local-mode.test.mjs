import assert from "node:assert/strict";
// Firebase mode OFF (no env). Firestore is a TRAP here: any use fails the test.
globalThis.__env = {};
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const FS = (globalThis.__fs ??= { docs: new Map(), listeners: new Set(), log: [], deny: () => false });
const { listingService, savedService } = await import("./listingService.js");
const { messageService } = await import("./messageService.js");
const { isFirebaseConfigured } = await import("./firebase.js");
const U = (id, status, name = "Juan Cruz") => ({ id, fullName: name, username: id, email: `${id}@x.com`, campus: "URS Binangonan", createdAt: "", ...(status ? { verificationStatus: status } : {}) });
const input = (o = {}) => ({ title: "Calc", price: 5, condition: "Good as new", category: "Books", description: "d", images: [], ...o });
const tick = () => new Promise((r) => setTimeout(r, 5));
let passed = 0; const t = async (n, f) => { try { await f(); passed++; console.log("PASS", n); } catch (e) { console.log("FAIL", n, "\n  ", e.message); process.exitCode = 1; } };
const latest = (subscribe, ...args) => { const box = { value: undefined }; const off = subscribe(...args, (v) => { box.value = v; }, (e) => { throw e; }); return { box, off }; };

await t("firebase is NOT configured in this run", () => assert.equal(isFirebaseConfigured, false));
await t("local mode: demo seed listings appear (intentional demo data) and subscribe() emits", async () => { const { box, off } = latest(listingService.subscribe); await tick(); assert.deepEqual(box.value.map((l) => l.id).sort(), ["seed-1", "seed-2", "seed-3"]); off(); });
await t("legacy local accounts (no verificationStatus) can create, edit, delete; subscribers update live", async () => {
  const u = U("u1"); const { box, off } = latest(listingService.subscribe); await tick();
  const made = await listingService.create(input({ title: "Mine" }), u); await tick(); assert.equal(box.value[0].id, made.id); assert.equal(box.value.length, 4);
  await listingService.update(made.id, input({ title: "Mine v2" }), u); await tick(); assert.equal(box.value.find((l) => l.id === made.id).title, "Mine v2");
  await assert.rejects(listingService.update(made.id, input(), U("other")), /own listings/); await assert.rejects(listingService.remove(made.id, U("other")), /own listings/);
  await listingService.remove(made.id, u); await tick(); assert.equal(box.value.length, 3); off(); });
await t("local mode: pending/rejected accounts are blocked", async () => { for (const s of ["pending", "rejected"]) { await assert.rejects(listingService.create(input(), U("p", s)), /verification|pending|approved/i); await assert.rejects(messageService.getOrCreateConversation({ id: "seed-1", title: "t", price: 1, sellerId: "seed-seller-1", sellerName: "B R." }, U("p", s)), /verification|pending|approved/i); } });
await t("local saved items: per account, guests have their own bucket, delete cleans every list", async () => {
  const u = U("u1"); const l = await listingService.create(input(), u);
  await savedService.set("u1", l.id, true); await savedService.set("u2", l.id, true); await savedService.set(null, "seed-1", true);
  const a = latest(savedService.subscribe, "u1"), g = latest(savedService.subscribe, null); await tick(); assert.deepEqual(a.box.value, [l.id]); assert.deepEqual(g.box.value, ["seed-1"]);
  await listingService.remove(l.id, u); await tick(); assert.deepEqual(a.box.value, []); assert.equal(JSON.parse(store.get("campuscart.saved") ?? "{}").u2?.includes(l.id) ?? false, false);
  await savedService.set("u1", "seed-1", true); await savedService.set("u1", "seed-1", false); await tick(); assert.deepEqual(a.box.value, []); a.off(); g.off(); });
await t("local messaging: one conversation per buyer+seller+listing, send, live updates, participants only", async () => {
  const buyer = U("b1", undefined, "Ben Cruz"); const listing = { id: "seed-1", title: "URS P.E UNIFORM", price: 1, sellerId: "seed-seller-1", sellerName: "Balmond R." };
  const c1 = await messageService.getOrCreateConversation(listing, buyer); const c2 = await messageService.getOrCreateConversation(listing, buyer); assert.equal(c1.id, c2.id);
  await assert.rejects(messageService.getOrCreateConversation({ ...listing, sellerId: "b1" }, buyer), /own listing/);
  const convs = latest(messageService.subscribeConversations, "b1"), msgs = latest(messageService.subscribeMessages, c1.id, "b1"), one = latest(messageService.subscribeConversation, c1.id, "b1"); await tick();
  assert.equal(convs.box.value.length, 1); assert.deepEqual(msgs.box.value, []); assert.equal(one.box.value.id, c1.id);
  await messageService.send(c1.id, buyer, "  hello  "); await tick(); assert.deepEqual(msgs.box.value.map((m) => m.text), ["hello"]); assert.equal(convs.box.value[0].lastMessage, "hello");
  await assert.rejects(messageService.send(c1.id, buyer, ""), /write a message/); await assert.rejects(messageService.send(c1.id, buyer, "x".repeat(1001)), /1000/); await assert.rejects(messageService.send(c1.id, U("intruder"), "hi"), /not available/);
  const outsider = latest(messageService.subscribeMessages, c1.id, "intruder"), outsiderConv = latest(messageService.subscribeConversation, c1.id, "intruder"); await tick(); assert.deepEqual(outsider.box.value, []); assert.equal(outsiderConv.box.value, null);
  await messageService.syncUserName(U("b1", undefined, "Benito Reyes")); await tick(); assert.equal(convs.box.value[0].buyerName, "Benito R."); [convs, msgs, one, outsider, outsiderConv].forEach((s) => s.off()); });
await t("local mode never used Firestore", () => assert.equal(FS.log.length, 0));
console.log(`\n${passed} passed`);

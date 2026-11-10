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
await t("local messaging: edit and delete your own messages; the preview and timestamps stay consistent", async () => {
  const me = U("m1", undefined, "Mia Cruz"); const other = U("o1", undefined, "Omar Reyes"); const listing = { id: "seed-2", title: "CALCULUS BOOK", price: 1, sellerId: "o1", sellerName: "Omar R." };
  const c = await messageService.getOrCreateConversation(listing, me); await messageService.send(c.id, me, "one"); await new Promise((r) => setTimeout(r, 3)); await messageService.send(c.id, other, "two"); await new Promise((r) => setTimeout(r, 3)); await messageService.send(c.id, me, "three");
  const msgs = latest(messageService.subscribeMessages, c.id, "m1"), convs = latest(messageService.subscribeConversations, "m1"); await tick();
  const [m1, m2, m3] = msgs.box.value; assert.deepEqual(msgs.box.value.map((m) => m.text), ["one", "two", "three"]);
  await messageService.edit(c.id, m1.id, me, "  one (fixed) "); await tick(); assert.equal(msgs.box.value[0].text, "one (fixed)"); assert.ok(msgs.box.value[0].editedAt); assert.equal(convs.box.value[0].lastMessage, "three", "older message: preview unchanged");
  await messageService.edit(c.id, m3.id, me, "three (fixed)"); await tick(); assert.equal(convs.box.value[0].lastMessage, "three (fixed)"); const stampBefore = convs.box.value[0].updatedAt;
  await assert.rejects(messageService.edit(c.id, m2.id, me, "hacked"), /only edit your own/); await assert.rejects(messageService.remove(c.id, m2.id, me), /only delete your own/);
  for (const bad of ["", "   ", "x".repeat(1001)]) await assert.rejects(messageService.edit(c.id, m1.id, me, bad)); assert.equal(msgs.box.value[0].text, "one (fixed)");
  await messageService.remove(c.id, m3.id, me); await tick(); assert.deepEqual(msgs.box.value.map((m) => m.text), ["one (fixed)", "two"]); assert.equal(convs.box.value[0].lastMessage, "two"); assert.equal(convs.box.value[0].updatedAt, m2.createdAt); assert.notEqual(convs.box.value[0].updatedAt, stampBefore);
  await messageService.remove(c.id, m1.id, me); await tick(); assert.deepEqual(msgs.box.value.map((m) => m.text), ["two"]); assert.equal(convs.box.value[0].lastMessage, "two", "not the latest: preview untouched");
  await messageService.remove(c.id, m2.id, other); await tick(); assert.deepEqual(msgs.box.value, []); assert.equal(convs.box.value[0].lastMessage, ""); assert.equal(convs.box.value[0].updatedAt, c.createdAt); assert.equal(convs.box.value.length, 1, "the conversation itself remains");
  await messageService.remove(c.id, m2.id, other); await assert.rejects(messageService.edit(c.id, m2.id, other, "x"), /no longer available/); [msgs, convs].forEach((x) => x.off()); });
await t("local messaging: pending/rejected accounts cannot edit; signed-out cannot edit or delete", async () => {
  const me = U("m2", undefined, "Mia Cruz"); const c = await messageService.getOrCreateConversation({ id: "seed-1", title: "t", price: 1, sellerId: "seed-seller-1", sellerName: "B R." }, me); await messageService.send(c.id, me, "hello");
  const m = latest(messageService.subscribeMessages, c.id, "m2"); await tick(); const id = m.box.value[0].id;
  for (const s of ["pending", "rejected"]) await assert.rejects(messageService.edit(c.id, id, { ...me, verificationStatus: s }, "x"), /verification|pending|approved/i);
  await assert.rejects(messageService.edit(c.id, id, null, "x"), /log in/i); await assert.rejects(messageService.remove(c.id, id, null), /log in/i); m.off(); });
await t("local mode never used Firestore", () => assert.equal(FS.log.length, 0));

// ---- unread counts and profile pictures in local mode (no Firebase) ----
await t("local mode: unread markers follow send / read / delete, per user, and survive a fresh subscription", async () => {
  const { summarizeUnread } = await import("./messageService.js");
  const buyer = U("ub1", undefined, "Una Buyer"); const listing = { id: "seed-9", title: "Thing", price: 1, sellerId: "seller-u", sellerName: "Sel L." };
  const conv = await messageService.getOrCreateConversation(listing, buyer); const seller = U("seller-u", undefined, "Sel Ler");
  const sellerBox = latest(messageService.subscribeUnread, "seller-u"), buyerBox = latest(messageService.subscribeUnread, "ub1"); await tick(); assert.equal(summarizeUnread(sellerBox.box.value).total, 0);
  await messageService.send(conv.id, buyer, "one"); await messageService.send(conv.id, buyer, "two"); await tick();
  assert.equal(summarizeUnread(sellerBox.box.value).total, 2); assert.equal(summarizeUnread(buyerBox.box.value).total, 0, "your own messages never count for you");
  await messageService.send(conv.id, seller, "reply"); await tick(); assert.equal(summarizeUnread(buyerBox.box.value).total, 1);
  const fresh = latest(messageService.subscribeUnread, "seller-u"); await tick(); assert.equal(summarizeUnread(fresh.box.value).total, 2, "still unread after reopening");
  const ids = summarizeUnread(sellerBox.box.value).idsByConversation.get(conv.id); await messageService.markRead("seller-u", [ids[0]]); await tick(); assert.equal(summarizeUnread(sellerBox.box.value).total, 1);
  await messageService.markRead("seller-u", [ids[0]]); await tick(); assert.equal(summarizeUnread(sellerBox.box.value).total, 1, "repeating is harmless");
  const msgs = latest(messageService.subscribeMessages, conv.id, "ub1"); await tick(); const mine = msgs.box.value.find((m) => m.text === "two"); await messageService.remove(conv.id, mine.id, buyer); await tick();
  assert.equal(summarizeUnread(sellerBox.box.value).total, 0, "deleting the unread message drops it from the count");
  [sellerBox, buyerBox, fresh, msgs].forEach((s) => s.off()); });
await t("local mode: there are no profile-picture addresses (pictures need an online account), so every avatar shows initials", async () => {
  const { avatarUrl } = await import("./avatarService.js"); assert.equal(avatarUrl("anyuid"), null); assert.equal(avatarUrl("anyuid", "2026-01-01T00:00:00Z"), null); });
// ---- Mark as Sold in local mode ----
await t("local mode: only the owner can mark an available listing as sold; it is one-way and stays in My listings / Saved", async () => {
  const owner = U("so1"), buyer = U("sb1"); const { box, off } = latest(listingService.subscribe); await tick();
  const made = await listingService.create(input({ title: "Sellable" }), owner); await tick(); assert.equal(box.value.find((l) => l.id === made.id).status, "available");
  await assert.rejects(listingService.markSold(made.id, buyer), /only mark your own/i); await assert.rejects(listingService.markSold(made.id, null), /log in/i); await assert.rejects(listingService.markSold("nope", owner), /only mark your own/i);
  assert.equal(box.value.find((l) => l.id === made.id).status, "available", "a refused attempt changes nothing");
  await savedService.set("sb1", made.id, true);
  await listingService.markSold(made.id, owner); await tick(); const sold = box.value.find((l) => l.id === made.id); assert.equal(sold.status, "sold"); assert.equal(sold.title, "Sellable"); assert.equal(sold.sellerId, "so1");
  await assert.rejects(listingService.markSold(made.id, owner), /already marked/i);
  assert.ok(listingService.forSeller(box.value, "so1").some((l) => l.id === made.id), "still in My listings"); const savedBox = latest(savedService.subscribe, "sb1"); await tick(); assert.ok(savedBox.box.value.includes(made.id), "still in Saved finds"); savedBox.off();
  assert.ok(!listingService.filter(box.value, {}).some((l) => l.id === made.id), "gone from the available catalog"); assert.ok(listingService.filter(box.value, { status: "sold" }).some((l) => l.id === made.id), "visible in the sold view");
  off(); });
await t("local mode: nobody can start a NEW chat about a sold item, but an existing chat stays", async () => {
  const owner = U("so2"), early = U("sb2"), late = U("sb3"); const made = await listingService.create(input({ title: "Gone soon" }), owner);
  const chat = await messageService.getOrCreateConversation(made, early); await messageService.send(chat.id, early, "hi"); await listingService.markSold(made.id, owner);
  const sold = { ...made, status: "sold" }; await assert.rejects(messageService.getOrCreateConversation(sold, late), /has been sold/i);
  assert.equal((await messageService.getOrCreateConversation(sold, early)).id, chat.id, "existing conversation preserved"); await messageService.send(chat.id, owner, "sorry, sold"); });
console.log(`\n${passed} passed`);

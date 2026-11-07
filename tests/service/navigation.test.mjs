// Android Back button: the decision rules, the interceptor stack, and how the native listener is installed/removed.
import assert from "node:assert/strict";
const { decideBack, readHistoryMark, parentRoute, registerBackInterceptor, runBackInterceptors } = await import("./navigation.js");
const { installAndroidBackButton } = await import("./androidBack.js");
const C = globalThis.__cap;
let passed = 0; const t = async (n, f) => { try { await f(); passed++; console.log("PASS", n); } catch (e) { console.log("FAIL", n, "\n  ", e.message); process.exitCode = 1; } };
const mark = (idx, from) => ({ idx, from });
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const resetCap = () => Object.assign(C, { native: true, platform: "android", available: true, listeners: [], removed: 0, exits: 0, addDelayMs: 0 });

await t("history marker: reads the app's marker, anything else means 'start of history'", () => {
  assert.deepEqual(readHistoryMark({ idx: 3, from: "home" }), { idx: 3, from: "home" });
  for (const bad of [null, undefined, {}, "x", 5, { idx: "2" }, { idx: -1, from: 4 }]) assert.deepEqual(readHistoryMark(bad), { idx: 0, from: null }); });
await t("main marketplace screen (and the first screen): Back exits the app", () => {
  for (const signedIn of [true, false]) { assert.deepEqual(decideBack({ route: "home", signedIn, mark: mark(0, null) }), { type: "exit" }); assert.deepEqual(decideBack({ route: "home", signedIn, mark: mark(4, "product") }), { type: "exit" }); assert.deepEqual(decideBack({ route: "welcome", signedIn, mark: mark(0, null) }), { type: "exit" }); } });
await t("a secondary screen with in-app history goes BACK in history (not out of the app)", () => {
  for (const route of ["product", "saved", "messages", "chat", "profile", "mylistings", "account", "campus", "help", "create", "edit", "admin"]) assert.deepEqual(decideBack({ route, signedIn: true, mark: mark(2, "home") }), { type: "history" }, route); });
await t("after a refresh on a deep screen (no history) Back goes UP to its parent, never straight out of the app", () => {
  const expected = { product: "home", chat: "messages", account: "profile", campus: "profile", help: "profile", mylistings: "profile", admin: "profile", edit: "mylistings", saved: "home", messages: "home", profile: "home", create: "home", login: "welcome", signup: "welcome" };
  for (const [route, parent] of Object.entries(expected)) assert.deepEqual(decideBack({ route, signedIn: true, mark: mark(0, null) }), { type: "navigate", route: parent }, route);
  assert.equal(parentRoute("unknown-screen"), "home"); });
await t("authentication screens: login/signup go back to welcome", () => {
  assert.deepEqual(decideBack({ route: "login", signedIn: false, mark: mark(1, "welcome") }), { type: "history" });
  assert.deepEqual(decideBack({ route: "signup", signedIn: false, mark: mark(2, "login") }), { type: "history" });
  assert.deepEqual(decideBack({ route: "signup", signedIn: false, mark: mark(0, null) }), { type: "navigate", route: "welcome" }); });
await t("a signed-in student is never sent back to login/welcome (and nothing logs them out)", () => {
  for (const from of ["login", "signup", "welcome"]) assert.deepEqual(decideBack({ route: "profile", signedIn: true, mark: mark(3, from) }), { type: "navigate", route: "home" }, from);
  assert.deepEqual(decideBack({ route: "profile", signedIn: false, mark: mark(3, "login") }), { type: "history" }); });
await t("interceptors (e.g. 'editing a message') get Back first, newest first; unregistering removes them", () => {
  const calls = []; const off1 = registerBackInterceptor(() => { calls.push("first"); return false; }); const off2 = registerBackInterceptor(() => { calls.push("second"); return true; });
  assert.equal(runBackInterceptors(), true); assert.deepEqual(calls, ["second"]); off2(); calls.length = 0; assert.equal(runBackInterceptors(), false); assert.deepEqual(calls, ["first"]); off1(); assert.equal(runBackInterceptors(), false); });
await t("Android: installs exactly ONE listener, 'handled' keeps the app open, 'exit' closes it", async () => {
  resetCap(); const off = installAndroidBackButton(() => "handled"); await wait(); assert.equal(C.listeners.length, 1); assert.equal(C.listeners[0].event, "backButton");
  C.listeners[0].listener({ canGoBack: true }); assert.equal(C.exits, 0); off();
  resetCap(); let decision = "handled"; const off2 = installAndroidBackButton(() => decision); await wait(); decision = "exit"; C.listeners[0].listener({ canGoBack: false }); await wait(); assert.equal(C.exits, 1); off2(); });
await t("Android: cleanup removes the listener (no leak), and calling it twice is harmless", async () => {
  resetCap(); const off = installAndroidBackButton(() => "handled"); await wait(); off(); off(); await wait(); assert.equal(C.removed, 1); assert.ok(C.listeners.every((l) => !l.active)); });
await t("Android: cleanup BEFORE the plugin answers still removes the late listener (React strict-mode / fast unmount)", async () => {
  resetCap(); C.addDelayMs = 30; const off = installAndroidBackButton(() => "handled"); off(); await wait(80); assert.equal(C.removed, 1); assert.ok(C.listeners.every((l) => !l.active)); });
await t("install / remove cycles never leave duplicates behind", async () => {
  resetCap(); for (let i = 0; i < 5; i += 1) { const off = installAndroidBackButton(() => "handled"); await wait(); off(); } await wait(); assert.equal(C.listeners.filter((l) => l.active).length, 0); assert.equal(C.removed, 5); });
await t("web, iOS, or a missing native plugin: nothing is installed and nothing throws", async () => {
  resetCap(); C.native = false; installAndroidBackButton(() => "handled")(); C.native = true; C.platform = "ios"; installAndroidBackButton(() => "handled")();
  C.platform = "android"; C.available = false; const warn = console.warn; const seen = []; console.warn = (m) => seen.push(m); installAndroidBackButton(() => "handled")(); console.warn = warn; await wait();
  assert.equal(C.listeners.length, 0); assert.match(seen[0], /@capacitor\/app/); });
console.log(`\n${passed} passed`);

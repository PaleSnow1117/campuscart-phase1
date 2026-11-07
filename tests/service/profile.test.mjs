// COR resubmission (client side), profile editing, e-mail change and student-number review, against the fake Auth/Firestore.
import assert from "node:assert/strict";
globalThis.__env = { VITE_FIREBASE_API_KEY: "a", VITE_FIREBASE_AUTH_DOMAIN: "b", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "d", VITE_SUPABASE_FUNCTIONS_URL: "https://x.supabase.co/functions/v1" };
globalThis.window = { addEventListener() {} };
const unhandled = []; process.on("unhandledRejection", (r) => unhandled.push(r));
console.warn = () => undefined;
const A = (globalThis.__auth ??= {}); const FS = (globalThis.__fs ??= {});
const { studentNumberService, toStudentNumberRequest } = await import("./studentNumberService.js");
const { adminService } = await import("./adminService.js");
const ts = (iso) => ({ toDate: () => new Date(iso), __iso: iso });
const reset = () => { Object.assign(A, { accounts: new Map(), current: null, listeners: new Set(), log: [], sentLinks: [] }); Object.assign(FS, { docs: new Map(), listeners: new Set(), log: [], offline: false, failCode: undefined, hang: false, delayMs: 0, delayByPath: undefined, deny: () => false, beforeTxGet: undefined }); server.calls.length = 0; server.mode = "ok"; };
const server = { calls: [], mode: "ok" };
// The submit-cor Edge Function, as a mock: it does what the real one does (store the file, THEN reopen a rejected request).
globalThis.fetch = async (url, init = {}) => {
  const name = String(url).split("/functions/v1/")[1]; const uid = (init.headers?.Authorization ?? "").replace("Bearer tok-", "");
  server.calls.push({ name, method: init.method, uid }); if (name !== "submit-cor") throw new Error("unexpected " + url);
  if (server.mode === "network") throw new TypeError("fetch failed");
  if (server.mode === "fail") return new Response(JSON.stringify({ error: "Something went wrong on our side. Please try again." }), { status: 503 });
  const doc = FS.docs.get(`users/${uid}`);
  if (doc?.verificationStatus === "pending") return new Response(JSON.stringify({ error: "Your verification is already under review." }), { status: 409 });
  if (doc?.verificationStatus === "approved") return new Response(JSON.stringify({ error: "Your registration was already submitted." }), { status: 409 });
  if (server.mode === "no-flag") return new Response(JSON.stringify({ ok: true, path: `${uid}/cor` }));
  if (doc?.verificationStatus === "rejected") { doc.verificationStatus = "pending"; doc.reviewedAt = null; doc.corVerifiedAt = null; return new Response(JSON.stringify({ ok: true, path: `${uid}/cor`, resubmitted: true })); }
  return new Response(JSON.stringify({ ok: true, path: `${uid}/cor` }));
};
let n = 0; const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const profile = (status, extra = {}) => ({ fullName: "Ana Reyes", username: "ana", email: "a@x.com", campus: "URS Binangonan", studentNumber: "2021-0001", verificationStatus: status, corStoragePath: "uidA/cor", ...extra });
async function open(status = "rejected", docExtra = {}) {
  A.accounts.set("a@x.com", { uid: "uidA", email: "a@x.com", password: "pw" }); A.current = { uid: "uidA", email: "a@x.com", getIdToken: async (force) => { if (force) A.log.push("getIdToken(true)"); return "tok-uidA"; } };
  FS.docs.set("users/uidA", profile(status, docExtra)); A.listeners = new Set();
  const mod = await import(`./firebaseAuthService.js?i=${++n}`); const states = []; const off = mod.firebaseAuthService.onAuthChange((s) => states.push(s));
  const end = Date.now() + 600; while (Date.now() < end && states.at(-1)?.status !== "ready") await wait(4);
  assert.equal(states.at(-1)?.status, "ready"); return { svc: mod.firebaseAuthService, states, last: () => states.at(-1), off };
}
const writesTo = (prefix) => FS.log.filter((e) => ["setDoc", "updateDoc", "deleteDoc"].includes(e[0]) && String(e[1]).startsWith(prefix));
const goodFile = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1])], "cor.pdf", { type: "application/pdf" });
let current = null, passed = 0;
const t = async (name, fn) => { reset(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { console.log("FAIL", name, "\n  ", e.message); process.exitCode = 1; } finally { if (current) { await current.svc.logout().catch(() => undefined); current.off(); current = null; } } };

// ============ COR resubmission (client) ============
await t("resubmit: a rejected student uploads a corrected COR, becomes PENDING, and keeps their account and details", async () => {
  current = await open("rejected"); const before = FS.docs.get("users/uidA"); const keep = { ...before };
  const user = await current.svc.resubmitCor(goodFile()); assert.equal(user.verificationStatus, "pending"); assert.equal(current.last().status, "ready"); assert.equal(current.last().user.verificationStatus, "pending");
  const after = FS.docs.get("users/uidA"); for (const field of ["fullName", "username", "email", "campus", "studentNumber", "corStoragePath"]) assert.equal(after[field], keep[field], field);
  assert.equal(current.last().user.id, "uidA"); assert.equal(A.current?.uid, "uidA"); assert.deepEqual(server.calls.map((c) => [c.name, c.method, c.uid]), [["submit-cor", "POST", "uidA"]]); });
await t("resubmit: the CLIENT never writes the verification status (only the server function does)", async () => { current = await open("rejected"); await current.svc.resubmitCor(goodFile()); assert.equal(writesTo("users/").length, 0, "no direct profile write from the app"); });
await t("resubmit: an invalid file (none, wrong type, empty, too large) is refused before anything is sent", async () => {
  current = await open("rejected"); const bad = [null, new File([new Uint8Array(4)], "x.exe", { type: "application/x-msdownload" }), new File([new Uint8Array(0)], "cor.pdf", { type: "application/pdf" }), { name: "big.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 }];
  for (const file of bad) await assert.rejects(current.svc.resubmitCor(file)); assert.equal(server.calls.length, 0); assert.equal(FS.docs.get("users/uidA").verificationStatus, "rejected"); assert.equal(current.last().user.verificationStatus, "rejected"); });
await t("resubmit: a failed upload (server error or no connection) leaves the status REJECTED and says so", async () => {
  current = await open("rejected"); server.mode = "fail"; await assert.rejects(current.svc.resubmitCor(goodFile()), /went wrong/i); server.mode = "network"; await assert.rejects(current.svc.resubmitCor(goodFile()), /Can't reach the server/i);
  assert.equal(FS.docs.get("users/uidA").verificationStatus, "rejected"); assert.equal(current.last().user.verificationStatus, "rejected"); assert.equal(current.last().status, "ready"); });
await t("resubmit: a response that doesn't confirm the resubmission is treated as a failure", async () => { current = await open("rejected"); server.mode = "no-flag"; await assert.rejects(current.svc.resubmitCor(goodFile()), /could not be submitted/i); assert.equal(current.last().user.verificationStatus, "rejected"); });
await t("resubmit: pending and approved students are refused by the server and their status is unchanged", async () => { for (const status of ["pending", "approved"]) { reset(); current = await open(status); await assert.rejects(current.svc.resubmitCor(goodFile()), status === "pending" ? /already under review/i : /already submitted/i); assert.equal(FS.docs.get("users/uidA").verificationStatus, status); await current.svc.logout(); current.off(); current = null; } });
await t("resubmit: if the status can't be re-read right after a successful upload, the student gets their current status, not an error", async () => { current = await open("rejected"); const original = FS.docs.get("users/uidA"); FS.beforeTxGet = undefined; const realFetch = globalThis.fetch; globalThis.fetch = async (u, i) => { const r = await realFetch(u, i); FS.offline = true; return r; }; const user = await current.svc.resubmitCor(goodFile()); globalThis.fetch = realFetch; assert.equal(user.verificationStatus, "rejected", "stale until the next check"); assert.equal(original.verificationStatus, "pending", "the server did reopen it"); });
await t("resubmit: signed-out users can't resubmit", async () => { current = await open("rejected"); await current.svc.logout(); await assert.rejects(current.svc.resubmitCor(goodFile()), /log in/i); assert.equal(server.calls.length, 0); });

// ============ profile editing ============
await t("profile: name, username and campus are saved, and ONLY the changed fields are written", async () => {
  current = await open("approved"); const user = current.last().user; const updated = await current.svc.updateProfile(user, { fullName: "  Ana Maria Reyes ", username: "ana", campus: "URS Tanay" });
  assert.equal(updated.fullName, "Ana Maria Reyes"); assert.equal(updated.campus, "URS Tanay"); const w = writesTo("users/uidA"); assert.equal(w.length, 1); assert.deepEqual(Object.keys(w[0][2]).sort(), ["campus", "fullName"]);
  assert.equal(FS.docs.get("users/uidA").verificationStatus, "approved"); assert.equal(current.last().user.fullName, "Ana Maria Reyes"); });
await t("profile: nothing changed means nothing is written", async () => { current = await open("approved"); const user = current.last().user; await current.svc.updateProfile(user, { fullName: user.fullName, username: user.username, campus: user.campus }); assert.equal(writesTo("users/").length, 0); });
await t("profile: invalid names and usernames are refused before any write", async () => {
  current = await open("approved"); const user = current.last().user;
  for (const bad of [{ fullName: " " }, { fullName: "A" }, { fullName: "x".repeat(101) }, { username: " " }, { username: "ab" }, { username: "has space" }, { username: "x".repeat(51) }, { campus: " " }]) await assert.rejects(current.svc.updateProfile(user, bad), Error, JSON.stringify(bad));
  assert.equal(writesTo("users/").length, 0); });
await t("profile: an existing short username isn't blocked unless the person changes it", async () => { current = await open("approved"); FS.docs.get("users/uidA").username = "al"; const user = { ...current.last().user, username: "al" }; await current.svc.updateProfile(user, { fullName: "Ana Maria", username: "al" }); assert.deepEqual(Object.keys(writesTo("users/uidA")[0][2]), ["fullName"]); });
await t("profile: protected fields can't be sent through updateProfile (status, student number, e-mail, admin flags are dropped)", async () => {
  current = await open("rejected"); const user = current.last().user; await current.svc.updateProfile(user, { fullName: "Ana Maria", verificationStatus: "approved", studentNumber: "9999-9999", email: "evil@x.com", corStoragePath: "x/cor", isAdmin: true, reviewedAt: "x" });
  const [w] = writesTo("users/uidA"); assert.deepEqual(Object.keys(w[2]), ["fullName"]); assert.equal(FS.docs.get("users/uidA").verificationStatus, "rejected"); assert.equal(FS.docs.get("users/uidA").studentNumber, "2021-0001"); });
await t("profile: a profile edit never changes verification status (pending / rejected / approved all stay)", async () => { for (const status of ["pending", "rejected", "approved"]) { reset(); current = await open(status); await current.svc.updateProfile(current.last().user, { username: "newname1" }); assert.equal(FS.docs.get("users/uidA").verificationStatus, status); assert.equal(current.last().user.verificationStatus, status); await current.svc.logout(); current.off(); current = null; } });

// ============ e-mail change (Firebase Authentication's verified flow) ============
await t("email: the password is re-checked, then a verification link goes to the NEW address; nothing else changes yet", async () => {
  current = await open("approved"); await current.svc.requestEmailChange(" New@URS.edu.ph ", "pw");
  assert.deepEqual(A.log.filter((l) => l === "reauth" || l.startsWith("verifyBefore")), ["reauth", "verifyBeforeUpdateEmail:new@urs.edu.ph"]); assert.equal(A.current.email, "a@x.com", "still the old e-mail until the link is opened");
  assert.equal(FS.docs.get("users/uidA").email, "a@x.com"); assert.equal(writesTo("users/").length, 0, "the profile is not touched"); });
await t("email: a wrong password sends nothing; invalid / same / already-used addresses are refused", async () => {
  current = await open("approved"); A.accounts.set("taken@x.com", { uid: "uidT", email: "taken@x.com", password: "x" });
  await assert.rejects(current.svc.requestEmailChange("new@x.com", "WRONG"), (e) => e.code === "auth/invalid-credential"); assert.ok(!A.log.some((l) => l.startsWith("verifyBefore")));
  await assert.rejects(current.svc.requestEmailChange("not-an-email", "pw"), /valid email/i); await assert.rejects(current.svc.requestEmailChange("A@x.com", "pw"), /already your email/i); await assert.rejects(current.svc.requestEmailChange("new@x.com", ""), /password/i);
  await assert.rejects(current.svc.requestEmailChange("taken@x.com", "pw"), (e) => e.code === "auth/email-already-in-use"); assert.equal(A.sentLinks.length, 0); });
await t("email: after the link was opened, the app shows the real sign-in e-mail and the profile follows (with a fresh token)", async () => {
  A.accounts.set("a@x.com", { uid: "uidA", email: "a@x.com", password: "pw" }); A.current = { uid: "uidA", email: "new@urs.edu.ph", getIdToken: async (force) => { if (force) A.log.push("getIdToken(true)"); return "tok-uidA"; } };
  FS.docs.set("users/uidA", profile("approved")); A.listeners = new Set(); const mod = await import(`./firebaseAuthService.js?i=${++n}`); const states = []; const off = mod.firebaseAuthService.onAuthChange((s) => states.push(s));
  const end = Date.now() + 600; while (Date.now() < end && states.at(-1)?.status !== "ready") await wait(4); current = { svc: mod.firebaseAuthService, off };
  assert.equal(states.at(-1).user.email, "new@urs.edu.ph"); assert.equal(FS.docs.get("users/uidA").email, "new@urs.edu.ph"); assert.ok(A.log.includes("getIdToken(true)")); assert.deepEqual(Object.keys(writesTo("users/uidA")[0][2]), ["email"]); });
await t("email: if the profile can't be updated yet, the app still works and shows the real e-mail", async () => {
  A.accounts.set("a@x.com", { uid: "uidA", email: "a@x.com", password: "pw" }); A.current = { uid: "uidA", email: "new@urs.edu.ph", getIdToken: async () => "tok-uidA" }; FS.docs.set("users/uidA", profile("approved")); FS.deny = (op, path) => op === "update" && path === "users/uidA"; A.listeners = new Set();
  const mod = await import(`./firebaseAuthService.js?i=${++n}`); const states = []; const off = mod.firebaseAuthService.onAuthChange((s) => states.push(s)); const end = Date.now() + 600; while (Date.now() < end && states.at(-1)?.status !== "ready") await wait(4); current = { svc: mod.firebaseAuthService, off };
  assert.equal(states.at(-1).status, "ready"); assert.equal(states.at(-1).user.email, "new@urs.edu.ph"); assert.equal(FS.docs.get("users/uidA").email, "a@x.com"); });
await t("email: nothing is written when the e-mail already matches", async () => { current = await open("approved"); assert.equal(writesTo("users/").length, 0); });

// ============ student number: request + administrator review ============
await t("student number: the student sends a REQUEST (pending); their profile number does not change", async () => {
  current = await open("approved"); await studentNumberService.request(current.last().user, " 2022-00999 "); const [w] = writesTo("studentNumberRequests/uidA"); assert.equal(w[0], "setDoc"); const d = w[2];
  assert.deepEqual(Object.keys(d).sort(), ["currentNumber", "requestedAt", "requestedNumber", "reviewedAt", "status"]); assert.equal(d.status, "pending"); assert.equal(d.requestedNumber, "2022-00999"); assert.equal(d.currentNumber, "2021-0001"); assert.equal(d.reviewedAt, null); assert.ok(d.requestedAt.__serverTimestamp);
  assert.equal(FS.docs.get("users/uidA").studentNumber, "2021-0001"); assert.equal(writesTo("users/").length, 0); });
await t("student number: invalid numbers and the same number are refused before any write", async () => { current = await open("approved"); for (const bad of ["", " ", "!", "a", "x".repeat(40), "2021-0001"]) await assert.rejects(studentNumberService.request(current.last().user, bad)); assert.equal(writesTo("studentNumberRequests/").length, 0); });
await t("student number: the student can read their own request back (and a missing one is null)", async () => { current = await open("approved"); assert.equal(await studentNumberService.get("uidA"), null); await studentNumberService.request(current.last().user, "2022-00999"); const r = await studentNumberService.get("uidA"); assert.equal(r.status, "pending"); assert.equal(r.requestedNumber, "2022-00999"); assert.equal(toStudentNumberRequest("u", { status: "weird", requestedNumber: "x" }), null); });
await t("student number: refused by the server (rules) -> the error is reported and nothing is stored", async () => { current = await open("approved"); FS.deny = (op, path) => path.startsWith("studentNumberRequests/"); await assert.rejects(studentNumberService.request(current.last().user, "2022-00999"), (e) => e.code === "permission-denied"); assert.ok(!FS.docs.has("studentNumberRequests/uidA")); });
const seedRequest = (uid = "uidA", over = {}) => { FS.docs.set(`studentNumberRequests/${uid}`, { requestedNumber: "2022-00999", currentNumber: "2021-0001", status: "pending", requestedAt: ts("2026-01-02T00:00:00Z"), reviewedAt: null, ...over }); FS.docs.set(`users/${uid}`, profile("approved", { studentNumber: "2021-0001" })); };
await t("admin: lists pending requests with the student's name and e-mail, oldest first, and skips decided ones", async () => { seedRequest("uidA"); seedRequest("uidB", { requestedAt: ts("2026-01-01T00:00:00Z"), requestedNumber: "2022-00111" }); seedRequest("uidC", { status: "approved" }); const list = await adminService.listStudentNumberRequests(); assert.deepEqual(list.map((r) => r.uid), ["uidB", "uidA"]); assert.equal(list[0].fullName, "Ana Reyes"); assert.equal(list[0].email, "a@x.com"); });
await t("admin: approving changes the number AND closes the request in ONE write; verification status untouched", async () => {
  seedRequest(); await adminService.reviewStudentNumber("uidA", true); const batch = FS.log.find((e) => e[0] === "batch")[1]; assert.equal(batch.length, 2);
  assert.deepEqual(batch.map((op) => op[1]).sort(), ["studentNumberRequests/uidA", "users/uidA"]); const userOp = batch.find((op) => op[1] === "users/uidA"); assert.deepEqual(Object.keys(userOp[2]), ["studentNumber"]); assert.equal(userOp[2].studentNumber, "2022-00999");
  assert.equal(FS.docs.get("users/uidA").studentNumber, "2022-00999"); assert.equal(FS.docs.get("studentNumberRequests/uidA").status, "approved"); assert.equal(FS.docs.get("users/uidA").verificationStatus, "approved"); });
await t("admin: rejecting only closes the request; the student's number is unchanged", async () => { seedRequest(); await adminService.reviewStudentNumber("uidA", false); assert.equal(FS.docs.get("studentNumberRequests/uidA").status, "rejected"); assert.equal(FS.docs.get("users/uidA").studentNumber, "2021-0001"); assert.equal(writesTo("users/").length + FS.log.filter((e) => e[0] === "batch" && e[1].some((op) => op[1].startsWith("users/"))).length, 0); });
await t("admin: a request that is no longer pending can't be approved again (no write)", async () => { seedRequest("uidA", { status: "approved" }); await assert.rejects(adminService.reviewStudentNumber("uidA", true), /no longer pending/i); assert.equal(FS.log.filter((e) => e[0] === "batch").length, 0); });
await t("admin: if the server refuses the approval, NEITHER the number nor the request changes (atomic)", async () => { seedRequest(); FS.deny = (op, path) => op === "update" && path === "users/uidA"; await assert.rejects(adminService.reviewStudentNumber("uidA", true), (e) => e.code === "permission-denied"); assert.equal(FS.docs.get("studentNumberRequests/uidA").status, "pending"); assert.equal(FS.docs.get("users/uidA").studentNumber, "2021-0001"); });
await t("no unhandled promise rejections in this file", async () => { await wait(30); assert.deepEqual(unhandled, []); });
console.log(`\n${passed} passed`);

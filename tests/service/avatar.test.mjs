// Profile pictures (client side): file checks, public URLs, upload / replace / remove orchestration against the fake
// Auth / Firestore and a mock of the profile-picture Edge Function. The real function is tested in tests/functions.
import assert from "node:assert/strict";
globalThis.__env = { VITE_FIREBASE_API_KEY: "a", VITE_FIREBASE_AUTH_DOMAIN: "b", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "d", VITE_SUPABASE_FUNCTIONS_URL: "https://abc.supabase.co/functions/v1/" };
globalThis.window = { addEventListener() {} };
process.on("unhandledRejection", () => undefined);
console.warn = () => undefined;
const A = (globalThis.__auth ??= {}); const FS = (globalThis.__fs ??= {});
const AV = await import("./avatarService.js");
const server = { calls: [], mode: "ok", path: undefined };
const reset = () => { Object.assign(A, { accounts: new Map(), current: null, listeners: new Set(), log: [], sentLinks: [] }); Object.assign(FS, { docs: new Map(), listeners: new Set(), log: [], offline: false, failCode: undefined, hang: false, delayMs: 0, delayByPath: undefined, deny: () => false, beforeTxGet: undefined }); server.calls.length = 0; server.mode = "ok"; server.path = undefined; AV.forgetAvatarFailures(); };
// Mock of the profile-picture function: uid comes ONLY from the bearer token, like the real one.
globalThis.fetch = async (url, init = {}) => {
  const name = String(url).split("/functions/v1/")[1]; const uid = (init.headers?.Authorization ?? "").replace("Bearer tok-", "");
  const file = init.body instanceof FormData ? init.body.get("file") : null; server.calls.push({ name, method: init.method, uid, file, hasAuth: Boolean(init.headers?.Authorization), url: String(url) });
  if (name !== "profile-picture") throw new Error("unexpected " + url);
  if (server.mode === "network") throw new TypeError("fetch failed");
  if (server.mode === "fail") return new Response(JSON.stringify({ error: "Something went wrong on our side. Please try again." }), { status: 503 });
  if (server.mode === "415") return new Response(JSON.stringify({ error: "Please choose a JPG, PNG or WebP image." }), { status: 415 });
  if (server.mode === "garbage") return new Response("<html>", { status: 200 });
  if (init.method === "DELETE") return new Response(JSON.stringify({ ok: true }));
  return new Response(JSON.stringify({ ok: true, path: server.path ?? `${uid}/avatar` }));
};
let n = 0; const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const profile = (extra = {}) => ({ fullName: "Ana Reyes", username: "ana", email: "a@x.com", campus: "URS Binangonan", studentNumber: "2021-0001", verificationStatus: "approved", corStoragePath: "uidA/cor", ...extra });
async function open(docExtra = {}) {
  A.accounts.set("a@x.com", { uid: "uidA", email: "a@x.com", password: "pw" }); A.current = { uid: "uidA", email: "a@x.com", getIdToken: async () => "tok-uidA" };
  FS.docs.set("users/uidA", profile(docExtra)); A.listeners = new Set();
  const mod = await import(`./firebaseAuthService.js?i=${++n}`); const states = []; const off = mod.firebaseAuthService.onAuthChange((s) => states.push(s));
  const end = Date.now() + 600; while (Date.now() < end && states.at(-1)?.status !== "ready") await wait(4);
  assert.equal(states.at(-1)?.status, "ready"); return { svc: mod.firebaseAuthService, last: () => states.at(-1), off };
}
const profileWrites = () => FS.log.filter((e) => ["setDoc", "updateDoc", "deleteDoc"].includes(e[0]) && String(e[1]).startsWith("users/"));
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const img = () => new Blob([JPG], { type: "image/jpeg" });
let current = null, passed = 0;
const t = async (name, fn) => { reset(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { console.log("FAIL", name, "\n  ", e.message); process.exitCode = 1; } finally { if (current) { await current.svc.logout().catch(() => undefined); current.off(); current = null; } } };

// ============ file checks (what the person picks) ============
const bytesOf = (...b) => new Blob([new Uint8Array(b)]);
const fileOf = (bytes, name = "x.jpg", type = "image/jpeg") => new File([bytes], name, { type });
await t("type: real bytes decide - JPEG, PNG and WebP are recognised, everything else is not", () => {
  const d = (...b) => AV.detectImageType(new Uint8Array(b));
  assert.equal(d(0xff, 0xd8, 0xff, 0xe1), "image/jpeg"); assert.equal(d(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"); assert.equal(d(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50), "image/webp");
  assert.equal(d(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45), null, "WAV is RIFF too"); assert.equal(d(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), null, "GIF"); assert.equal(d(0x25, 0x50, 0x44, 0x46, 0x2d), null, "PDF"); assert.equal(d(0x3c, 0x73, 0x76, 0x67), null, "SVG"); assert.equal(d(), null); assert.equal(d(0xff, 0xd8), null); });
await t("validate: a real image passes even with a wrong name or MIME type", async () => { assert.equal(await AV.validateAvatarFile(fileOf(JPG, "holiday.txt", "text/plain")), null); assert.equal(await AV.validateAvatarFile(fileOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "a.bin", "")), null); });
await t("validate: a fake image (exe, gif, svg, pdf, text) is refused whatever it is called", async () => {
  for (const b of [[0x4d, 0x5a, 0x90, 0, 3], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1], [0x3c, 0x73, 0x76, 0x67], [0x25, 0x50, 0x44, 0x46, 0x2d, 1], [0x68, 0x69]]) assert.match(await AV.validateAvatarFile(fileOf(new Uint8Array(b), "me.jpg", "image/jpeg")), /JPG, PNG or WebP/); });
await t("validate: nothing chosen, empty, and too large are refused with a clear message", async () => {
  assert.match(await AV.validateAvatarFile(null), /choose a picture/i); assert.match(await AV.validateAvatarFile(fileOf(new Uint8Array(0))), /empty/i);
  const huge = { size: AV.AVATAR_INPUT_MAX_BYTES + 1, slice: () => bytesOf(0xff, 0xd8, 0xff) }; assert.match(await AV.validateAvatarFile(huge), /too large.*10 MB/i);
  assert.equal(await AV.validateAvatarFile({ size: AV.AVATAR_INPUT_MAX_BYTES, slice: () => bytesOf(0xff, 0xd8, 0xff) }), null, "exactly the limit is fine");
  assert.match(await AV.validateAvatarFile({ size: 10, slice: () => ({ arrayBuffer: () => Promise.reject(new Error("io")) }) }), /couldn't be read/i); });
await t("limits: the server-side limit is 2 MB and the accepted types match the bucket", () => { assert.equal(AV.AVATAR_MAX_BYTES, 2 * 1024 * 1024); assert.equal(AV.AVATAR_ACCEPT, "image/jpeg,image/png,image/webp"); assert.equal(AV.AVATAR_BUCKET, "profile-pictures"); assert.ok(AV.AVATAR_SIZE <= 512); });

// ============ public addresses ============
await t("url: built from the functions URL and the user id only (trailing slash tolerated)", () => {
  assert.equal(AV.avatarUrl("uidA"), "https://abc.supabase.co/storage/v1/object/public/profile-pictures/uidA/avatar"); assert.equal(AV.avatarStoragePath("uidA"), "uidA/avatar"); });
await t("url: the owner's change time becomes a cache-busting version; a bad time is ignored", () => {
  assert.equal(AV.avatarUrl("uidA", "2026-01-02T03:04:05.000Z"), `https://abc.supabase.co/storage/v1/object/public/profile-pictures/uidA/avatar?v=${Date.parse("2026-01-02T03:04:05.000Z")}`); assert.ok(!AV.avatarUrl("uidA", "garbage").includes("?")); assert.ok(!AV.avatarUrl("uidA", null).includes("?")); });
await t("url: ids that could escape the folder or aren't real user ids give no address", () => { for (const bad of ["", null, undefined, "../x", "a/b", "uid A", "seed-seller-1", "a?b=1", "x".repeat(129), "u%2e"]) assert.equal(AV.avatarUrl(bad), null, String(bad)); });
await t("failures: a picture that failed to load is not retried for a few minutes, then is tried again", () => {
  const url = AV.avatarUrl("uidB"); assert.equal(AV.avatarRecentlyFailed(url), false); const real = Date.now; let now = real(); Date.now = () => now;
  try { AV.noteAvatarFailure(url); assert.equal(AV.avatarRecentlyFailed(url), true); now += 4 * 60 * 1000; assert.equal(AV.avatarRecentlyFailed(url), true); now += 2 * 60 * 1000; assert.equal(AV.avatarRecentlyFailed(url), false, "retried after 5 minutes"); } finally { Date.now = real; }
  assert.equal(AV.avatarRecentlyFailed(AV.avatarUrl("uidC")), false, "other users are unaffected"); });

// ============ upload / replace ============
await t("upload: the picture goes to the function with the person's own token, then ONLY photoPath and photoUpdatedAt are written to their profile", async () => {
  current = await open(); const before = { ...FS.docs.get("users/uidA") }; const user = await current.svc.updateProfilePhoto(current.last().user, img());
  assert.equal(server.calls.length, 1); const [call] = server.calls; assert.deepEqual([call.name, call.method, call.uid, call.hasAuth], ["profile-picture", "POST", "uidA", true]); assert.equal(call.url, "https://abc.supabase.co/functions/v1/profile-picture"); assert.equal(call.file.type, "image/jpeg"); assert.equal(call.file.size, JPG.length);
  const [, path, data] = profileWrites().at(-1); assert.equal(path, "users/uidA"); assert.deepEqual(Object.keys(data).sort(), ["photoPath", "photoUpdatedAt"]); assert.equal(data.photoPath, "uidA/avatar"); assert.ok(data.photoUpdatedAt.__serverTimestamp, "a server time, never the device clock");
  assert.equal(user.photoPath, "uidA/avatar"); assert.ok(Date.parse(user.photoUpdatedAt) > 0); assert.equal(current.last().user.photoPath, "uidA/avatar", "the app state is updated");
  const after = FS.docs.get("users/uidA"); for (const f of ["fullName", "username", "email", "campus", "studentNumber", "verificationStatus", "corStoragePath"]) assert.equal(after[f], before[f], f); });
await t("upload: verification status, student number and COR path are never touched, for any status", async () => {
  for (const status of ["pending", "rejected", "approved"]) { reset(); current = await open({ verificationStatus: status }); await current.svc.updateProfilePhoto(current.last().user, img()); assert.equal(FS.docs.get("users/uidA").verificationStatus, status); assert.equal(current.last().user.verificationStatus, status); await current.svc.logout(); current.off(); current = null; } });
await t("upload: replacing an existing picture uses the same path and stays a single profile write", async () => {
  current = await open({ photoPath: "uidA/avatar" }); await current.svc.updateProfilePhoto(current.last().user, img()); await current.svc.updateProfilePhoto(current.last().user, img()); assert.equal(profileWrites().length, 2); assert.ok(profileWrites().every((w) => w[2].photoPath === "uidA/avatar")); });
await t("upload: the target is always the signed-in account (the id sent comes from the token, not from the caller)", async () => {
  current = await open(); await assert.rejects(current.svc.updateProfilePhoto({ ...current.last().user, id: "uidB" }, img()), /log in again/i); assert.equal(server.calls.length, 0); assert.equal(profileWrites().length, 0); });
await t("upload: signed out -> refused, nothing sent", async () => { current = await open(); const u = current.last().user; await current.svc.logout(); await assert.rejects(current.svc.updateProfilePhoto(u, img()), /log in again/i); assert.equal(server.calls.length, 0); });
await t("upload: an empty or over-2 MB blob is refused before anything is sent", async () => {
  current = await open(); await assert.rejects(current.svc.updateProfilePhoto(current.last().user, new Blob([])), /empty/i); await assert.rejects(current.svc.updateProfilePhoto(current.last().user, { size: 2 * 1024 * 1024 + 1 }), /too large/i); assert.equal(server.calls.length, 0); assert.equal(profileWrites().length, 0); });
await t("upload: server errors are shown and the profile is NOT changed (no path pointing at a picture that doesn't exist)", async () => {
  current = await open(); for (const [mode, re] of [["fail", /went wrong/i], ["network", /Can't reach the server/i], ["415", /JPG, PNG or WebP/i], ["garbage", /could not be confirmed/i]]) { server.mode = mode; await assert.rejects(current.svc.updateProfilePhoto(current.last().user, img()), re, mode); }
  assert.equal(profileWrites().length, 0); assert.equal(current.last().user.photoPath, null); assert.equal(FS.docs.get("users/uidA").photoPath, undefined); });
await t("upload: a path that isn't the caller's own is rejected, even if the server said so", async () => { current = await open(); server.path = "uidB/avatar"; await assert.rejects(current.svc.updateProfilePhoto(current.last().user, img()), /could not be confirmed/i); assert.equal(profileWrites().length, 0); });
await t("upload: if Firestore refuses the profile update, the person is told and the app state is unchanged", async () => {
  current = await open(); FS.deny = (op, path) => op === "update" && path === "users/uidA"; await assert.rejects(current.svc.updateProfilePhoto(current.last().user, img()), (e) => e.code === "permission-denied"); assert.equal(current.last().user.photoPath, null); assert.equal(FS.docs.get("users/uidA").photoPath, undefined); });
await t("login: the picture is read from the profile, and profiles without one (older accounts) simply have none", async () => {
  current = await open({ photoPath: "uidA/avatar", photoUpdatedAt: { toDate: () => new Date("2026-02-03T04:05:06Z") } }); assert.equal(current.last().user.photoPath, "uidA/avatar"); assert.equal(current.last().user.photoUpdatedAt, "2026-02-03T04:05:06.000Z"); await current.svc.logout(); current.off(); current = null;
  reset(); current = await open(); assert.equal(current.last().user.photoPath, null); assert.equal(current.last().user.photoUpdatedAt, null); });
await t("login: a bad stored value is treated as no picture", async () => { current = await open({ photoPath: 42 }); assert.equal(current.last().user.photoPath, null); });

// ============ remove ============
await t("remove: the stored file is deleted FIRST, then the profile fields are cleared (both null)", async () => {
  current = await open({ photoPath: "uidA/avatar" }); const user = await current.svc.removeProfilePhoto(current.last().user); assert.deepEqual(server.calls.map((c) => [c.name, c.method, c.uid]), [["profile-picture", "DELETE", "uidA"]]);
  const [, path, data] = profileWrites().at(-1); assert.equal(path, "users/uidA"); assert.deepEqual(data, { photoPath: null, photoUpdatedAt: null }); assert.equal(user.photoPath, null); assert.equal(current.last().user.photoPath, null); assert.equal(FS.docs.get("users/uidA").photoPath, null);
  assert.equal(FS.docs.get("users/uidA").verificationStatus, "approved"); });
await t("remove: if the file can't be deleted, NOTHING changes (the profile still points at a picture that exists)", async () => {
  current = await open({ photoPath: "uidA/avatar" }); server.mode = "fail"; await assert.rejects(current.svc.removeProfilePhoto(current.last().user), /went wrong/i); server.mode = "network"; await assert.rejects(current.svc.removeProfilePhoto(current.last().user), /Can't reach the server/i);
  assert.equal(profileWrites().length, 0); assert.equal(current.last().user.photoPath, "uidA/avatar"); });
await t("remove: if clearing the profile fails after the file was deleted, trying again finishes the job", async () => {
  current = await open({ photoPath: "uidA/avatar" }); FS.deny = (op, path) => op === "update" && path === "users/uidA"; await assert.rejects(current.svc.removeProfilePhoto(current.last().user), (e) => e.code === "permission-denied"); FS.deny = () => false;
  await current.svc.removeProfilePhoto(current.last().user); assert.equal(FS.docs.get("users/uidA").photoPath, null); assert.equal(server.calls.length, 2); });
await t("remove: only the signed-in account's picture can be removed; signed out is refused", async () => {
  current = await open({ photoPath: "uidA/avatar" }); await assert.rejects(current.svc.removeProfilePhoto({ ...current.last().user, id: "uidB" }), /log in again/i); const u = current.last().user; await current.svc.logout(); await assert.rejects(current.svc.removeProfilePhoto(u), /log in again/i); assert.equal(server.calls.length, 0); });
console.log(`\n${passed} passed`);

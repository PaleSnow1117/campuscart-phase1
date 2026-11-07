import assert from "node:assert/strict";
const PROJECT = "campuscart-1887f";
Object.assign(process.env, { FIREBASE_PROJECT_ID: PROJECT, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-NOT-REAL",
  ALLOWED_ORIGINS: "http://localhost:5173, https://localhost", FIREBASE_WEB_API_KEY: "k", ATTESTOR_EMAIL: "attestor@example.com", ATTESTOR_PASSWORD: "p" });

// ---- mock Firebase REST: profiles are served only to their owner (like the rules); the attestor may only make the
// ---- two changes the rules allow (record corVerifiedAt; reopen a REJECTED profile as pending, with the exact values)
const profiles = new Map(); const admins = new Set(["ADMIN1"]); const patches = []; const hooks = {};
let clock = 0; const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const subOf = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url")).sub;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("robot/v1/metadata/x509")) return reply({ kid1: "GOOD-KEY" }, 200, { "cache-control": "max-age=3600" });
  if (url.includes("accounts:signInWithPassword")) return reply({ idToken: "attestor-token", expiresIn: "3600" });
  if (!url.includes("firestore.googleapis.com")) throw new Error("unexpected fetch " + url);
  if (hooks.down) return new Response("{}", { status: 500 });
  const method = init.method ?? "GET"; const bearer = (init.headers?.Authorization ?? "").replace("Bearer ", ""); const caller = bearer === "attestor-token" ? "ATTESTOR" : subOf(bearer);
  const u = new URL(url); const [collection, id] = u.pathname.split("/documents/")[1].split("/");
  if (method === "GET") {
    if (caller !== id) return reply({}, 403);
    if (collection === "admins") return admins.has(id) ? reply({}) : reply({}, 404);
    const p = profiles.get(id); return p ? reply({ name: `users/${id}`, fields: { verificationStatus: { stringValue: p.status } }, updateTime: p.updateTime }) : reply({}, 404);
  }
  if (method === "PATCH") {
    if (caller !== "ATTESTOR") return reply({}, 403);
    hooks.beforePatch?.(id);
    const p = profiles.get(id); if (!p) return reply({}, 404);
    const mask = u.searchParams.getAll("updateMask.fieldPaths").sort().join(","); const body = JSON.parse(init.body).fields;
    patches.push({ id, mask, precondition: u.searchParams.get("currentDocument.updateTime"), body });
    if (hooks.patchFails) return reply({}, 500);
    if (mask === "corVerifiedAt") { if (u.searchParams.get("currentDocument.exists") !== "true") return reply({}, 400); p.corVerifiedAt = body.corVerifiedAt.timestampValue; p.updateTime = stamp(); return reply({}); }
    if (mask === "corVerifiedAt,reviewedAt,verificationStatus") {
      if (p.status !== "rejected") return reply({}, 403);                                   // rule: only a REJECTED profile
      if (body.verificationStatus?.stringValue !== "pending" || !("nullValue" in body.reviewedAt) || !("nullValue" in body.corVerifiedAt)) return reply({}, 403);
      if (u.searchParams.get("currentDocument.updateTime") !== p.updateTime) return reply({}, 400); // changed since it was read
      Object.assign(p, { status: "pending", reviewedAt: null, corVerifiedAt: null, updateTime: stamp() }); return reply({});
    }
    return reply({}, 403);
  }
  throw new Error("unexpected method " + method);
};
const now = Math.floor(Date.now() / 1000);
const token = (sub, o = {}) => { const b = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"); return [b({ alg: "RS256", kid: "kid1" }), b({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub, iat: now - 10, auth_time: now - 10, exp: now + 3500, ...o }), "validsig"].join("."); };
await import("./supabase/functions/submit-cor/index.ts"); await import("./supabase/functions/verify-cor/index.ts"); await import("./supabase/functions/profile-picture/index.ts");
const [submit, verify, avatar] = globalThis.__handlers; const store = globalThis.__store;
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]), NEWPDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 9, 9, 9]), PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3]);
const URL_ = "https://f.supabase.co/functions/v1/";
const upload = async (tok, bytes, { name = "cor.pdf", type = "application/pdf", extra = {}, length } = {}) => {
  const make = () => { const f = new FormData(); f.append("file", new File([bytes], name, { type })); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const size = (await new Request(URL_ + "submit-cor", { method: "POST", body: make() }).arrayBuffer()).byteLength;
  const headers = { ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }; if (length !== null) headers["Content-Length"] = String(length ?? size);
  return submit(new Request(URL_ + "submit-cor", { method: "POST", body: make(), headers }));
};
const call = (fn, name, method, tok, body) => fn(new Request(URL_ + name, { method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }));
const reset = () => { store.objects.clear(); store.calls.length = 0; store.failUpload = false; store.failRemove = false; store.bucketOf.clear(); profiles.clear(); patches.length = 0; for (const k of Object.keys(hooks)) delete hooks[k]; };
const profile = (status, extra = {}) => ({ status, updateTime: stamp(), reviewedAt: status === "pending" ? undefined : "2026-01-01T00:00:00Z", corVerifiedAt: "2026-01-01T00:00:00Z", ...extra });
const S = "student1", OTHER = "student2";
let passed = 0; const t = async (name, fn) => { reset(); try { await fn(); passed++; console.log("PASS", name); } catch (e) { console.log("FAIL", name, "\n  ", e.message); process.exitCode = 1; } };
const stored = (uid = S) => store.objects.get(`${uid}/cor`);

// ============ signup (no profile yet): unchanged behaviour ============
await t("signup: a new student's COR is stored at {uid}/cor in the private bucket; no profile write happens", async () => { const r = await upload(token(S), PDF); assert.equal(r.status, 200); const b = await r.json(); assert.equal(b.path, `${S}/cor`); assert.equal(b.resubmitted, undefined); assert.deepEqual([...store.buckets], ["student-cors"]); assert.equal(stored().contentType, "application/pdf"); assert.equal(patches.length, 0); });
await t("signup: the file's real type decides (an executable named .png is refused); empty / too large / no size are refused", async () => { assert.equal((await upload(token(S), EXE, { name: "cor.png", type: "image/png" })).status, 415); assert.equal((await upload(token(S), new Uint8Array(0))).status, 400); assert.equal((await upload(token(S), PDF, { length: 11 * 1024 * 1024 })).status, 413); assert.equal((await upload(token(S), PDF, { length: null })).status, 411); assert.equal(store.objects.size, 0); });
await t("signup: no token / bad token -> 401 and nothing is stored", async () => { assert.equal((await upload(null, PDF)).status, 401); assert.equal((await upload("a.b.c", PDF)).status, 401); assert.equal(store.objects.size, 0); });
await t("signup rollback: DELETE removes only the caller's own unfinished file", async () => { store.objects.set(`${S}/cor`, { bytes: PDF }); store.objects.set(`${OTHER}/cor`, { bytes: PDF }); assert.equal((await call(submit, "submit-cor", "DELETE", token(S))).status, 200); assert.ok(!stored()); assert.ok(stored(OTHER)); });
await t("DELETE is refused once a profile exists (even a rejected one): the stored COR is never deleted that way", async () => { for (const status of ["rejected", "pending", "approved"]) { reset(); profiles.set(S, profile(status)); store.objects.set(`${S}/cor`, { bytes: PDF }); assert.equal((await call(submit, "submit-cor", "DELETE", token(S))).status, 409, status); assert.ok(stored(), status); } });

// ============ resubmission ============
await t("resubmit: a REJECTED student's corrected COR replaces the old file and reopens the request as pending", async () => {
  profiles.set(S, profile("rejected")); store.objects.set(`${S}/cor`, { bytes: PDF, contentType: "application/pdf" });
  const r = await upload(token(S), NEWPDF); assert.equal(r.status, 200); const b = await r.json(); assert.equal(b.resubmitted, true); assert.equal(b.path, `${S}/cor`);
  assert.deepEqual([...stored().bytes], [...NEWPDF]); assert.equal(profiles.get(S).status, "pending"); });
await t("resubmit: the old review data and the old attestation are cleared, so the NEW file must be verified again", async () => { profiles.set(S, profile("rejected")); await upload(token(S), NEWPDF); const p = profiles.get(S); assert.equal(p.reviewedAt, null); assert.equal(p.corVerifiedAt, null); });
await t("resubmit: nothing is left behind in Supabase (one object, same path, upsert)", async () => { profiles.set(S, profile("rejected")); store.objects.set(`${S}/cor`, { bytes: PDF }); await upload(token(S), NEWPDF); assert.deepEqual([...store.objects.keys()], [`${S}/cor`]); assert.equal(store.calls.filter((c) => c[0] === "upload")[0][2].upsert, true); assert.ok(!store.calls.some((c) => c[0] === "remove")); });
await t("resubmit: the status change is made by the attestor with exactly the allowed fields and a precondition on the profile version", async () => {
  const p = profile("rejected"); profiles.set(S, p); const before = p.updateTime; await upload(token(S), NEWPDF); assert.equal(patches.length, 1); const [patch] = patches;
  assert.equal(patch.id, S); assert.equal(patch.mask, "corVerifiedAt,reviewedAt,verificationStatus"); assert.equal(patch.precondition, before);
  assert.deepEqual(Object.keys(patch.body).sort(), ["corVerifiedAt", "reviewedAt", "verificationStatus"]); assert.equal(patch.body.verificationStatus.stringValue, "pending"); });
await t("resubmit: the student's own profile data is untouched (only status / review / attestation fields are written)", async () => { profiles.set(S, profile("rejected")); await upload(token(S), NEWPDF); for (const patch of patches) assert.ok(!Object.keys(patch.body).some((f) => ["studentNumber", "email", "fullName", "campus", "username", "corStoragePath", "createdAt"].includes(f))); });
await t("resubmit: PENDING and APPROVED students are refused (409) and nothing changes", async () => { for (const status of ["pending", "approved"]) { reset(); profiles.set(S, profile(status)); store.objects.set(`${S}/cor`, { bytes: PDF }); const r = await upload(token(S), NEWPDF); assert.equal(r.status, 409, status); assert.deepEqual([...stored().bytes], [...PDF], status); assert.equal(patches.length, 0); assert.equal(profiles.get(S).status, status); assert.ok(!store.calls.some((c) => c[0] === "upload")); } });
await t("resubmit: a failed upload leaves the status REJECTED, the old file intact, and writes nothing to the profile", async () => { profiles.set(S, profile("rejected")); store.objects.set(`${S}/cor`, { bytes: PDF }); store.failUpload = true; const r = await upload(token(S), NEWPDF); assert.equal(r.status, 503); assert.equal(profiles.get(S).status, "rejected"); assert.deepEqual([...stored().bytes], [...PDF]); assert.equal(patches.length, 0); });
await t("resubmit: an invalid replacement (wrong type, empty, too big) changes nothing", async () => { profiles.set(S, profile("rejected")); store.objects.set(`${S}/cor`, { bytes: PDF }); assert.equal((await upload(token(S), EXE, { name: "cor.png", type: "image/png" })).status, 415); assert.equal((await upload(token(S), new Uint8Array(0))).status, 400); assert.equal((await upload(token(S), PDF, { length: 11 * 1024 * 1024 })).status, 413); assert.equal(profiles.get(S).status, "rejected"); assert.deepEqual([...stored().bytes], [...PDF]); assert.equal(patches.length, 0); });
await t("resubmit: if the profile update fails after the upload, the status stays REJECTED (the student can simply try again)", async () => { profiles.set(S, profile("rejected")); hooks.patchFails = true; const r = await upload(token(S), NEWPDF); assert.equal(r.status, 503); assert.equal(profiles.get(S).status, "rejected"); hooks.patchFails = false; const again = await upload(token(S), NEWPDF); assert.equal(again.status, 200); assert.equal(profiles.get(S).status, "pending"); });
await t("resubmit: if an administrator APPROVED the profile while the file was uploading, that decision is NOT overwritten", async () => { profiles.set(S, profile("rejected")); hooks.beforePatch = (id) => { const p = profiles.get(id); p.status = "approved"; p.updateTime = stamp(); }; const r = await upload(token(S), NEWPDF); assert.notEqual(r.status, 200); assert.equal(profiles.get(S).status, "approved"); assert.equal(patches.length, 1, "the attempt was made, and refused"); });
await t("resubmit: if the profile changed while uploading but is still rejected, the stale update is refused with a clear 409", async () => { profiles.set(S, profile("rejected")); hooks.beforePatch = (id) => { profiles.get(id).updateTime = stamp(); }; const r = await upload(token(S), NEWPDF); assert.equal(r.status, 409); assert.match((await r.json()).error, /changed while uploading/i); assert.equal(profiles.get(S).status, "rejected"); });
await t("resubmit: Firestore unreachable -> 503, nothing uploaded", async () => { profiles.set(S, profile("rejected")); hooks.down = true; const r = await upload(token(S), NEWPDF); assert.equal(r.status, 503); assert.equal(store.objects.size, 0); });
await t("resubmit: a student can only ever replace their OWN COR, whatever the request says", async () => { profiles.set(S, profile("rejected")); profiles.set(OTHER, profile("rejected")); store.objects.set(`${OTHER}/cor`, { bytes: PDF }); const r = await upload(token(S), NEWPDF, { extra: { uid: OTHER, studentUid: OTHER, path: `${OTHER}/cor` } }); assert.equal(r.status, 200); assert.deepEqual([...stored(OTHER).bytes], [...PDF]); assert.equal(profiles.get(OTHER).status, "rejected"); assert.equal(profiles.get(S).status, "pending"); assert.deepEqual(patches.map((p) => p.id), [S]); });
await t("resubmit: no token / forged token -> 401 and the profile is untouched", async () => { profiles.set(S, profile("rejected")); assert.equal((await upload(null, NEWPDF)).status, 401); assert.equal((await upload(token(S, { aud: "other" }), NEWPDF)).status, 401); assert.equal(profiles.get(S).status, "rejected"); assert.equal(store.objects.size, 0); });
await t("resubmit twice in a row: the second is refused because the first already made it pending", async () => { profiles.set(S, profile("rejected")); assert.equal((await upload(token(S), NEWPDF)).status, 200); assert.equal((await upload(token(S), PNG, { name: "c.png", type: "image/png" })).status, 409); assert.deepEqual([...stored().bytes], [...NEWPDF]); });

// ============ after resubmission the admin flow works on the new file ============
await t("admin: the newly submitted COR can be verified again (fresh attestation), which is what approval requires", async () => {
  profiles.set(S, profile("rejected")); await upload(token(S), NEWPDF); assert.equal(profiles.get(S).corVerifiedAt, null);
  assert.equal((await call(verify, "verify-cor", "POST", token("ADMIN1"), { studentUid: S })).status, 200); assert.ok(profiles.get(S).corVerifiedAt, "re-attested"); assert.equal(profiles.get(S).status, "pending"); });
await t("admin: verify-cor still refuses non-admins (a student cannot attest their own new file)", async () => { profiles.set(S, profile("rejected")); await upload(token(S), NEWPDF); assert.equal((await call(verify, "verify-cor", "POST", token(S), { studentUid: S })).status, 403); assert.equal(profiles.get(S).corVerifiedAt, null); });
// ============================================================================================================
// PROFILE PICTURES (profile-picture function). Appended AFTER the COR tests on purpose: the COR tests assert that
// only the "student-cors" bucket was ever opened, and these open "profile-pictures".
// ============================================================================================================
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG_IMG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
const SVG = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
const avatarCall = async (tok, bytes, { name = "me.jpg", type = "image/jpeg", extra = {}, length, headers = {} } = {}) => {
  const make = () => { const f = new FormData(); f.append("file", new File([bytes], name, { type })); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const size = (await new Request(URL_ + "profile-picture", { method: "POST", body: make() }).arrayBuffer()).byteLength;
  const h = { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers }; if (length !== null) h["Content-Length"] = String(length ?? size);
  return avatar(new Request(URL_ + "profile-picture", { method: "POST", body: make(), headers: h }));
};
const avatarDelete = (tok, headers = {}) => avatar(new Request(URL_ + "profile-picture", { method: "DELETE", headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers } }));
const pic = (uid = S) => store.objects.get(`${uid}/avatar`);

await t("avatar: JPG, PNG and WebP are stored at {uid}/avatar in the PUBLIC profile-pictures bucket, typed by their real bytes", async () => {
  profiles.set(S, profile("approved"));
  for (const [bytes, type] of [[JPG, "image/jpeg"], [PNG_IMG, "image/png"], [WEBP, "image/webp"]]) {
    // the client-supplied name and MIME type are deliberately WRONG: only the bytes count
    const r = await avatarCall(token(S), bytes, { name: "whatever.bin", type: "application/octet-stream" });
    assert.equal(r.status, 200, type); const b = await r.json(); assert.deepEqual(b, { ok: true, path: `${S}/avatar` }); assert.equal(pic().contentType, type);
  }
  assert.equal(store.bucketOf.get(`${S}/avatar`), "profile-pictures"); assert.deepEqual([...store.objects.keys()], [`${S}/avatar`]); });
await t("avatar: any verification status may have a picture (pending, rejected, approved); no Firestore write is made by the function", async () => {
  for (const status of ["pending", "rejected", "approved"]) { reset(); profiles.set(S, profile(status)); assert.equal((await avatarCall(token(S), JPG)).status, 200, status); assert.ok(pic(), status); assert.equal(patches.length, 0); assert.equal(profiles.get(S).status, status); } });
await t("avatar: a replacement overwrites the same path (upsert) and leaves nothing behind", async () => {
  profiles.set(S, profile("approved")); await avatarCall(token(S), JPG); assert.equal((await avatarCall(token(S), PNG_IMG)).status, 200);
  assert.deepEqual([...store.objects.keys()], [`${S}/avatar`]); assert.equal(pic().contentType, "image/png"); const uploads = store.calls.filter((c) => c[0] === "upload");
  assert.equal(uploads.length, 2); for (const u of uploads) { assert.equal(u[1], `${S}/avatar`); assert.equal(u[2].upsert, true); assert.equal(u[2].cacheControl, "300"); } assert.ok(!store.calls.some((c) => c[0] === "remove")); });
await t("avatar: the real type decides - executable, GIF, SVG (script), PDF, WAV-in-RIFF and plain text are refused with 415 even when named .jpg", async () => {
  profiles.set(S, profile("approved")); for (const [bytes, label] of [[EXE, "exe"], [GIF, "gif"], [SVG, "svg"], [PDF, "pdf"], [WAV, "wav"], [new TextEncoder().encode("hello"), "text"]]) assert.equal((await avatarCall(token(S), bytes, { name: "me.jpg", type: "image/jpeg" })).status, 415, label);
  assert.equal(store.objects.size, 0); assert.equal(store.calls.filter((c) => c[0] === "upload").length, 0); });
await t("avatar: empty, over-2 MB (by header AND by real size) and unknown-size uploads are refused; exactly 2 MB is accepted", async () => {
  profiles.set(S, profile("approved")); assert.equal((await avatarCall(token(S), new Uint8Array(0))).status, 400);
  assert.equal((await avatarCall(token(S), JPG, { length: 3 * 1024 * 1024 })).status, 413, "declared size too big");
  const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(JPG); assert.equal((await avatarCall(token(S), big)).status, 413, "real size too big");
  assert.equal((await avatarCall(token(S), JPG, { length: null })).status, 411); assert.equal(store.objects.size, 0);
  const exact = new Uint8Array(2 * 1024 * 1024); exact.set(JPG); assert.equal((await avatarCall(token(S), exact)).status, 200); assert.equal(pic().bytes.length, 2 * 1024 * 1024); });
await t("avatar: a missing file field is refused", async () => { profiles.set(S, profile("approved")); const f = new FormData(); f.append("note", "hi"); const size = (await new Request(URL_ + "x", { method: "POST", body: f }).arrayBuffer()).byteLength;
  const r = await avatar(new Request(URL_ + "profile-picture", { method: "POST", body: f, headers: { Authorization: `Bearer ${token(S)}`, "Content-Length": String(size) } })); assert.equal(r.status, 400); assert.equal(store.objects.size, 0); });
await t("avatar: a student can only ever write THEIR OWN picture, whatever the request says (uid / path / studentUid fields are ignored)", async () => {
  profiles.set(S, profile("approved")); profiles.set(OTHER, profile("approved")); store.objects.set(`${OTHER}/avatar`, { bytes: JPG, contentType: "image/jpeg" });
  const r = await avatarCall(token(S), PNG_IMG, { extra: { uid: OTHER, studentUid: OTHER, path: `${OTHER}/avatar`, bucket: "student-cors" } }); assert.equal(r.status, 200); assert.equal((await r.json()).path, `${S}/avatar`);
  assert.deepEqual([...pic(OTHER).bytes], [...JPG], "the other student's picture is untouched"); assert.deepEqual([...pic().bytes], [...PNG_IMG]); assert.deepEqual(store.calls.filter((c) => c[0] === "upload").map((c) => c[1]), [`${S}/avatar`]); });
await t("avatar: does not touch the COR (different bucket, different path) - an existing COR survives upload and delete", async () => {
  profiles.set(S, profile("rejected")); store.objects.set(`${S}/cor`, { bytes: PDF, contentType: "application/pdf" }); store.bucketOf.set(`${S}/cor`, "student-cors");
  await avatarCall(token(S), JPG); await avatarDelete(token(S)); assert.deepEqual([...store.objects.get(`${S}/cor`).bytes], [...PDF]); assert.equal(profiles.get(S).status, "rejected"); assert.equal(patches.length, 0); });
await t("avatar: no token, malformed token, wrong audience -> 401 and nothing is stored or removed", async () => {
  profiles.set(S, profile("approved")); store.objects.set(`${S}/avatar`, { bytes: JPG });
  for (const tok of [null, "a.b.c", token(S, { aud: "other-project" }), token(S, { exp: now - 3600 })]) { assert.equal((await avatarCall(tok, PNG_IMG)).status, 401); assert.equal((await avatarDelete(tok)).status, 401); }
  assert.deepEqual([...pic().bytes], [...JPG]); assert.equal(store.calls.filter((c) => c[0] === "upload" || c[0] === "remove").length, 0); });
await t("avatar: someone who has not finished signing up (no profile) is refused with 409 and nothing is stored", async () => { assert.equal((await avatarCall(token(S), JPG)).status, 409); assert.equal(store.objects.size, 0); });
await t("avatar: DELETE removes only the caller's own picture; deleting when there is none is fine", async () => {
  profiles.set(S, profile("approved")); store.objects.set(`${S}/avatar`, { bytes: JPG }); store.objects.set(`${OTHER}/avatar`, { bytes: JPG });
  assert.equal((await avatarDelete(token(S))).status, 200); assert.ok(!pic()); assert.ok(pic(OTHER)); assert.deepEqual(store.calls.filter((c) => c[0] === "remove"), [["remove", [`${S}/avatar`]]]);
  assert.equal((await avatarDelete(token(S))).status, 200, "already gone is not an error"); assert.ok(pic(OTHER)); });
await t("avatar: a student cannot delete another student's picture (the target can't be chosen: query, header and body are ignored)", async () => {
  profiles.set(S, profile("approved")); store.objects.set(`${OTHER}/avatar`, { bytes: JPG });
  const r = await avatar(new Request(URL_ + `profile-picture?uid=${OTHER}&path=${OTHER}/avatar`, { method: "DELETE", headers: { Authorization: `Bearer ${token(S)}`, "X-Uid": OTHER, "Content-Type": "application/json" }, body: JSON.stringify({ uid: OTHER, studentUid: OTHER, path: `${OTHER}/avatar` }) }));
  assert.equal(r.status, 200); assert.ok(pic(OTHER), "untouched"); assert.deepEqual(store.calls.filter((c) => c[0] === "remove"), [["remove", [`${S}/avatar`]]]); });
await t("avatar: storage failures are reported (503) and the old picture survives a failed upload", async () => {
  profiles.set(S, profile("approved")); store.objects.set(`${S}/avatar`, { bytes: JPG }); store.failUpload = true; const r = await avatarCall(token(S), PNG_IMG); assert.equal(r.status, 503); assert.match((await r.json()).error, /went wrong/i); assert.deepEqual([...pic().bytes], [...JPG]);
  store.failRemove = true; assert.equal((await avatarDelete(token(S))).status, 503); assert.ok(pic()); });
await t("avatar: if Firestore is unreachable the request fails closed (503) and nothing is stored", async () => { profiles.set(S, profile("approved")); hooks.down = true; assert.equal((await avatarCall(token(S), JPG)).status, 503); assert.equal((await avatarDelete(token(S))).status, 503); assert.equal(store.objects.size, 0); });
await t("avatar: error responses never leak tokens, the service-role key or storage details", async () => {
  profiles.set(S, profile("approved")); store.failUpload = true; const tok = token(S); const body = await (await avatarCall(tok, JPG)).text();
  for (const secret of [tok, "service-role-NOT-REAL", "student-cors", "profile-pictures", "x.supabase.co"]) assert.ok(!body.includes(secret), secret); });
await t("avatar: CORS - a browser Origin that is not allow-listed is refused (403, no CORS headers); allowed origins are echoed exactly; preflight advertises DELETE", async () => {
  profiles.set(S, profile("approved")); const bad = await avatarCall(token(S), JPG, { headers: { Origin: "https://evil.example" } }); assert.equal(bad.status, 403); assert.equal(bad.headers.get("access-control-allow-origin"), null); assert.equal(store.objects.size, 0);
  const ok = await avatarCall(token(S), JPG, { headers: { Origin: "https://localhost" } }); assert.equal(ok.status, 200); assert.equal(ok.headers.get("access-control-allow-origin"), "https://localhost");
  const pre = await avatar(new Request(URL_ + "profile-picture", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } })); assert.equal(pre.status, 204); assert.match(pre.headers.get("access-control-allow-methods"), /DELETE/); assert.match(pre.headers.get("access-control-allow-methods"), /POST/); });
await t("avatar: other HTTP methods are refused (405)", async () => { profiles.set(S, profile("approved")); for (const method of ["GET", "PUT", "PATCH"]) assert.equal((await avatar(new Request(URL_ + "profile-picture", { method, headers: { Authorization: `Bearer ${token(S)}` } }))).status, 405, method); });
console.log(`\n${passed} passed`);

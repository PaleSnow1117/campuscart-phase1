// Tests the REAL token verifier with the real jose library (the author could not run these: no Deno here).
// Run from the project root:  deno test --allow-env --allow-net=none supabase/functions/_shared/auth_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { generateKeyPair, SignJWT } from "npm:jose@5";
import { HttpError } from "./errors.ts";
import { verifyFirebaseToken } from "./auth.ts";

const PROJECT = "campuscart-1887f";
const good = await generateKeyPair("RS256");
const other = await generateKeyPair("RS256");
const resolver = (key: unknown) => async (kid: string) => (kid === "kid1" ? key : null) as never;
const sign = (opts: { key?: CryptoKey; claims?: Record<string, unknown>; iss?: string; aud?: string; exp?: string | number; sub?: string; alg?: string; kid?: string } = {}) =>
  new SignJWT({ auth_time: Math.floor(Date.now() / 1000) - 5, ...(opts.claims ?? {}) })
    .setProtectedHeader({ alg: (opts.alg ?? "RS256") as "RS256", kid: opts.kid ?? "kid1" })
    .setIssuer(opts.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(opts.aud ?? PROJECT)
    .setSubject(opts.sub ?? "student1")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? good.privateKey);
const verify = (token: string) => verifyFirebaseToken(token, PROJECT, resolver(good.publicKey));
const rejects = (token: string) => assertRejects(() => verify(token), HttpError);

Deno.test("accepts a valid token and returns the uid from sub", async () => { assertEquals((await verify(await sign())).uid, "student1"); });
Deno.test("rejects wrong signing key", async () => { await rejects(await sign({ key: other.privateKey })); });
Deno.test("rejects wrong audience", async () => { await rejects(await sign({ aud: "other-project" })); });
Deno.test("rejects wrong issuer", async () => { await rejects(await sign({ iss: "https://evil.example" })); });
Deno.test("rejects expired token", async () => { await rejects(await sign({ exp: Math.floor(Date.now() / 1000) - 3600 })); });
Deno.test("rejects unknown kid", async () => { await rejects(await sign({ kid: "nope" })); });
Deno.test("rejects empty subject", async () => { await rejects(await sign({ sub: "" })); });
Deno.test("rejects auth_time in the future", async () => { await rejects(await sign({ claims: { auth_time: Math.floor(Date.now() / 1000) + 3600 } })); });
Deno.test("rejects a token missing auth_time", async () => {
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "kid1" }).setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(PROJECT).setSubject("student1").setIssuedAt().setExpirationTime("1h").sign(good.privateKey);
  await rejects(token);
});
Deno.test("rejects alg none and tampered payloads", async () => {
  const header = btoa(JSON.stringify({ alg: "none", kid: "kid1" })).replace(/=+$/, "");
  const payload = btoa(JSON.stringify({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "ADMIN1", exp: 9999999999, iat: 1, auth_time: 1 })).replace(/=+$/, "");
  await rejects(`${header}.${payload}.`);
  const valid = await sign();
  const [h, , s] = valid.split(".");
  await rejects(`${h}.${payload}.${s}`);
});

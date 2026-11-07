// Stand-in for jose: it applies the same checks (issuer, audience, expiry, required claims) but with a fake
// signature, so these tests exercise OUR code around the token check, not jose's cryptography.
const b64 = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
export function decodeProtectedHeader(t) { const p = t.split("."); if (p.length !== 3) throw new Error("malformed"); return b64(p[0]); }
export async function importX509(pem) { return pem; }
export async function jwtVerify(t, key, o) {
  if (key !== "GOOD-KEY") throw new Error("signature verification failed");
  const [h, p, sig] = t.split("."); if (sig !== "validsig") throw new Error("signature verification failed");
  if (!o.algorithms.includes(b64(h).alg)) throw new Error("alg");
  const payload = b64(p); const now = Math.floor(o.currentDate.getTime() / 1000);
  if (payload.iss !== o.issuer) throw new Error("iss"); if (payload.aud !== o.audience) throw new Error("aud");
  if (payload.exp + o.clockTolerance < now) throw new Error("expired");
  for (const c of o.requiredClaims) if (!(c in payload)) throw new Error("missing " + c);
  return { payload };
}

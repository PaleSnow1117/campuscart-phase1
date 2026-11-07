// Edge Function tests (submit-cor, verify-cor), run under Node with stand-ins for Deno, jose and Supabase.
//
//   node tests/functions/run.mjs        (needs Node 22 or newer, which can run TypeScript files directly)
//
// What this checks: our request handling and authorization around the token check, file validation, storage paths,
// the signup / resubmission rules, and exactly what is written to Firestore. What it does NOT check: jose's real
// signature verification (see supabase/functions/_shared/auth_test.ts for Deno), real Supabase or real Firestore.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
if (Number(process.versions.node.split(".")[0]) < 22) {
  console.log(`Skipped: these tests need Node 22+ (this is ${process.versions.node}).`);
  process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), "campuscart-function-tests-"));
try {
  cpSync(join(root, "supabase", "functions"), join(work, "supabase", "functions"), { recursive: true });
  writeFileSync(join(work, "supabase", "package.json"), '{"type":"module"}');
  for (const file of ["hooks.mjs", "register.mjs", "jose-stub.mjs", "supabase-stub.mjs", "functions.test.mjs"]) cpSync(join(here, file), join(work, file));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./register.mjs", "functions.test.mjs"], { cwd: work, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}

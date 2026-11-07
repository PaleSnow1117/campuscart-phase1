// Service-level tests for the Firestore marketplace code, using an IN-MEMORY FAKE Firestore.
//
//   node tests/service/run.mjs
//
// What this checks: what OUR client code reads and writes (document shapes, ownership, validation, one
// conversation per buyer+listing, batching, subscriptions, "Firebase mode never uses localStorage", local
// mode still works). What it does NOT check: the real Firestore service or the security rules. For the rules
// run rules-tests/*.test.mjs in the Firebase emulator (see FIREBASE_SETUP.md).
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = mkdtempSync(join(tmpdir(), "campuscart-service-tests-"));
try {
  const files = ["listingService", "messageService", "firestoreMarketplace", "firebase", "firebaseAuthService", "navigation", "androidBack", "adminService", "studentNumberService", "avatarService"].map((name) => join(root, "src", "data", `${name}.ts`));
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--ignoreConfig", ...files, "--outDir", out,
    "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--lib", "es2022,dom", "--types", "vite/client"],
    { stdio: "inherit", cwd: root });
  writeFileSync(join(out, "package.json"), '{"type":"module"}');
  for (const name of readdirSync(out).filter((entry) => entry.endsWith(".js"))) {
    const source = readFileSync(join(out, name), "utf8")
      .replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"')
      .replace(/import\.meta\.env/g, "globalThis.__env");
    writeFileSync(join(out, name), source);
  }
  mkdirSync(join(out, "node_modules"), { recursive: true });
  cpSync(join(here, "fake-firebase"), join(out, "node_modules", "firebase"), { recursive: true });
  mkdirSync(join(out, "node_modules", "@capacitor"), { recursive: true });
  cpSync(join(here, "fake-capacitor"), join(out, "node_modules", "@capacitor", "core"), { recursive: true });
  let failed = false;
  for (const test of ["fb-mode.test.mjs", "local-mode.test.mjs", "navigation.test.mjs", "message-edit.test.mjs", "profile.test.mjs", "unread.test.mjs", "avatar.test.mjs"]) { 
    cpSync(join(here, test), join(out, test));
    console.log(`\n=== ${test} ===`);
    const result = spawnSync(process.execPath, ["--no-warnings", test], { cwd: out, stdio: "inherit" });
    if (result.status !== 0) failed = true;
  }
  console.log(failed ? "\nSOME SERVICE TESTS FAILED" : "\nAll service tests passed.");
  process.exitCode = failed ? 1 : 0;
} finally {
  rmSync(out, { recursive: true, force: true });
}

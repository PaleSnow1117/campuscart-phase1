import { createClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./errors.ts";
import { COR_BUCKET } from "./validate.ts";

// Uses the service-role key that the Supabase platform injects into Edge Functions as an environment
// variable. It exists only inside the function runtime. It is never sent to the browser, logged or committed.
export function corBucket() {
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage.from(COR_BUCKET);
}

// Maps the Deno-style "npm:" imports used by the Edge Functions to local stand-ins.
export async function resolve(specifier, context, next) {
  if (specifier === "npm:jose@5") return { url: new URL("./jose-stub.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "npm:@supabase/supabase-js@2") return { url: new URL("./supabase-stub.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}

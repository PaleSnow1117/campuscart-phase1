// In-memory Supabase Storage (one private bucket). Records every call so tests can check what was stored.
export const store = (globalThis.__store ??= { objects: new Map(), calls: [], buckets: new Set(), bucketOf: new Map(), failUpload: false, failRemove: false });
export function createClient(url, key) {
  if (!url || !key) throw new Error("missing url/key");
  return { storage: { from(bucket) {
    store.buckets.add(bucket);
    return {
      async upload(path, file, opts) { store.calls.push(["upload", path, opts]); if (store.failUpload) return { error: { message: "x" } };
        store.objects.set(path, { bytes: new Uint8Array(await file.arrayBuffer()), contentType: opts.contentType }); store.bucketOf.set(path, bucket); return { error: null }; },
      async remove(paths) { store.calls.push(["remove", paths]); if (store.failRemove) return { error: { message: "x" } }; for (const p of paths) store.objects.delete(p); return { error: null }; },
      async download(path) { const o = store.objects.get(path); return o ? { data: new Blob([o.bytes]), error: null } : { data: null, error: { message: "not found" } }; },
      async createSignedUrl(path, seconds) { store.calls.push(["sign", path, seconds]); return store.objects.has(path) ? { data: { signedUrl: `https://x/${bucket}/${path}?exp=${seconds}` }, error: null } : { data: null, error: { message: "not found" } }; },
    };
  } } };
}

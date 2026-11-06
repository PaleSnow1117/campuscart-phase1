const W = (globalThis.__fs ??= { docs: new Map(), listeners: new Set(), log: [], deny: () => false, offline: false });
const err = (code) => Object.assign(new Error(code), { code });
const SERVER_TS = { __serverTimestamp: true };
const stamp = (iso) => ({ toDate: () => new Date(iso), __iso: iso });
const resolve = (v) => (v && v.__serverTimestamp ? stamp(new Date().toISOString()) : v);
const resolveAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v : resolve(v)]));
export const getFirestore = () => ({ __db: true });
export const serverTimestamp = () => SERVER_TS;
export const limit = (n) => ({ t: "limit", n }), orderBy = (f, d = "asc") => ({ t: "orderBy", f, d }), where = (f, op, v) => ({ t: "where", f, op, v });
const join = (base, parts) => [base, ...parts].filter(Boolean).join("/");
export function collection(parent, ...parts) { const base = parent.__db ? "" : parent.path; return { kind: "collection", path: join(base, parts) }; }
export function doc(parent, ...parts) {
  if (parent.kind === "collection" && parts.length === 0) return { kind: "doc", path: parent.path + "/AUTO" + (++W.auto || (W.auto = 1)), id: "AUTO" + W.auto };
  if (parent.kind === "collection") return { kind: "doc", path: join(parent.path, parts), id: parts.join("/").split("/").pop() };
  const base = parent.__db ? "" : parent.path; const path = join(base, parts); return { kind: "doc", path, id: path.split("/").pop() };
}
export const query = (c, ...constraints) => ({ kind: "query", path: c.path, constraints });
const inCollection = (path, coll) => path.startsWith(coll + "/") && !path.slice(coll.length + 1).includes("/");
const snapOf = (path) => { const d = W.docs.get(path); return { id: path.split("/").pop(), ref: { kind: "doc", path, id: path.split("/").pop() }, exists: () => !!d, data: () => (d ? { ...d } : undefined) }; };
function run(q) {
  let rows = [...W.docs.keys()].filter((p) => inCollection(p, q.path)).map(snapOf);
  for (const c of q.constraints ?? []) {
    if (c.t === "where") rows = rows.filter((r) => (c.op === "==" ? r.data()[c.f] === c.v : c.op === "array-contains" ? (r.data()[c.f] ?? []).includes(c.v) : true));
  }
  const ob = (q.constraints ?? []).find((c) => c.t === "orderBy");
  if (ob) rows.sort((a, b) => { const x = a.data()[ob.f]?.__iso ?? a.data()[ob.f], y = b.data()[ob.f]?.__iso ?? b.data()[ob.f]; return (x > y ? 1 : x < y ? -1 : 0) * (ob.d === "desc" ? -1 : 1); });
  const lim = (q.constraints ?? []).find((c) => c.t === "limit"); if (lim) rows = rows.slice(0, lim.n);
  return rows;
}
const emitAll = () => W.listeners.forEach((fn) => fn());
export function onSnapshot(target, next, error) {
  const fire = () => { try { if (W.offline) return; next(target.kind === "doc" ? snapOf(target.path) : { docs: run(target) }); } catch (e) { error?.(e); } };
  const l = () => fire(); W.listeners.add(l); W.log.push(["onSnapshot", target.kind, target.path, JSON.stringify(target.constraints ?? [])]);
  if (W.denyRead?.(target)) { queueMicrotask(() => error?.(err("permission-denied"))); return () => W.listeners.delete(l); }
  queueMicrotask(fire); return () => W.listeners.delete(l);
}
export async function getDocFromServer(ref) { W.log.push(["getDocFromServer", ref.path]); if (W.offline) throw err("unavailable"); return snapOf(ref.path); }
export async function getDocs(q) { W.log.push(["getDocs", q.path]); if (W.offline) throw err("unavailable"); return { docs: run(q) }; }
const applyWrite = (op, path, data) => {
  if (W.deny(op, path, data)) throw err("permission-denied");
  if (op === "set") W.docs.set(path, resolveAll(data));
  else if (op === "update") { if (!W.docs.has(path)) throw err("not-found"); W.docs.set(path, { ...W.docs.get(path), ...resolveAll(data) }); }
  else if (op === "delete") W.docs.delete(path);
};
export async function setDoc(ref, data) { W.log.push(["setDoc", ref.path, data]); applyWrite("set", ref.path, data); emitAll(); }
export async function updateDoc(ref, data) { W.log.push(["updateDoc", ref.path, data]); applyWrite("update", ref.path, data); emitAll(); }
export async function deleteDoc(ref) { W.log.push(["deleteDoc", ref.path]); applyWrite("delete", ref.path); emitAll(); }
export function writeBatch() {
  const ops = [];
  return { set: (r, d) => ops.push(["set", r.path, d]), update: (r, d) => ops.push(["update", r.path, d]), delete: (r) => ops.push(["delete", r.path]),
    commit: async () => { W.log.push(["batch", ops.map((o) => [o[0], o[1], o[2]])]); const snapshot = new Map(W.docs); try { for (const o of ops) applyWrite(o[0], o[1], o[2]); } catch (e) { W.docs = snapshot; throw e; } emitAll(); } };
}
export const getDoc = async (ref) => getDocFromServer(ref);

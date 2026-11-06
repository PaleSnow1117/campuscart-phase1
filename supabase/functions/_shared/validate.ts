// Pure helpers with no Deno or network dependencies, so they can be unit-tested anywhere.

export const COR_BUCKET = "student-cors";
export const COR_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export type CorType = "application/pdf" | "image/jpeg" | "image/png";

/** Identify the file from its first bytes. The client-supplied MIME type is never trusted. */
export function detectCorType(bytes: Uint8Array): CorType | null {
  const at = (index: number) => bytes[index] ?? -1;
  // %PDF-
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return "application/pdf";
  // FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  // 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((value, index) => at(index) === value)) return "image/png";
  return null;
}

/** Firebase email/password UIDs are alphanumeric. Anything else is refused before it reaches a path. */
export function isValidUid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{1,128}$/.test(value);
}

/** The ONLY place the storage path is built. It is derived from a verified identity, never from client input. */
export function corObjectPath(uid: string): string {
  if (!isValidUid(uid)) throw new Error("Invalid uid");
  return `${uid}/cor`;
}

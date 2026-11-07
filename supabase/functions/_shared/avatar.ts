import { isValidUid } from "./validate.ts";

// Pure helpers for profile pictures, with no Deno or network dependencies, so they can be unit-tested anywhere.
// (Kept apart from validate.ts so nothing about the COR upload is touched.)

export const AVATAR_BUCKET = "profile-pictures";
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB, the same limit the bucket itself enforces
/** How long browsers/CDNs may reuse a picture. The path never changes, so this bounds how stale other people's view can be. */
export const AVATAR_CACHE_SECONDS = "300";
export type AvatarType = "image/jpeg" | "image/png" | "image/webp";

/** Identify the image from its first bytes. The client-supplied MIME type is never trusted. */
export function detectAvatarType(bytes: Uint8Array): AvatarType | null {
  const at = (index: number) => bytes[index] ?? -1;
  // FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  // 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((value, index) => at(index) === value)) return "image/png";
  // "RIFF" <4 size bytes> "WEBP"
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
      at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

/** The ONLY place the avatar path is built. It is derived from a verified identity, never from client input. */
export function avatarObjectPath(uid: string): string {
  if (!isValidUid(uid)) throw new Error("Invalid uid");
  return `${uid}/avatar`;
}

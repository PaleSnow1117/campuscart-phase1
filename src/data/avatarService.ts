import { callFunction } from "./corService";
import { functionsUrl } from "./firebase";

// Profile pictures. The browser never touches Supabase Storage with a key: the picture is sent to the
// profile-picture Edge Function together with the student's Firebase ID token, and the function decides the
// storage path itself ("{uid}/avatar", taken from the verified token). Reading is public: the bucket is public so
// other students can see a picture, and its address only depends on the user id.
//
// Firestore keeps only the PATH (users/{uid}.photoPath) plus a change time that is used purely to refresh caches
// of the owner's own picture. Other students' pictures are looked up by user id and fall back to initials when
// there is none (or when it can't be loaded).

export const AVATAR_BUCKET = "profile-pictures";
/** What the server accepts (also the bucket limit). The browser shrinks every picture far below this before upload. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Largest original we are willing to decode. Phone photos are usually 2-8 MB, so the 2 MB limit applies to the resized upload. */
export const AVATAR_INPUT_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_INPUT_MAX_LABEL = "10 MB";
/** Value for <input accept>. */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";
/** Pictures are cropped to a square and shrunk to at most this many pixels per side. */
export const AVATAR_SIZE = 512;
const AVATAR_JPEG_QUALITY = 0.9;

export type AvatarType = "image/jpeg" | "image/png" | "image/webp";

/** Identify an image from its first bytes (the same check the server makes). The file name and MIME type are never trusted. */
export function detectImageType(bytes: Uint8Array): AvatarType | null {
  const at = (index: number) => bytes[index] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => at(index) === value)) return "image/png";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
      at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

/** Must match what the Edge Function derives from the token. */
export function avatarStoragePath(uid: string): string {
  return `${uid}/avatar`;
}

const SAFE_UID = /^[A-Za-z0-9]{1,128}$/;

/** https://<ref>.supabase.co/storage/v1/object/public/profile-pictures, derived from the functions URL. Null when it can't be derived. */
function publicBase(): string | null {
  const match = /^(https?:\/\/[^/]+)\/functions\/v1$/i.exec(functionsUrl);
  return match ? `${match[1]}/storage/v1/object/public/${AVATAR_BUCKET}` : null;
}

/**
 * Public address of a user's picture, or null when pictures are unavailable (local mode, odd ids).
 * `version` (the owner's photoUpdatedAt) is added as a query string so a replaced picture shows up immediately for
 * its owner instead of after the cache expires.
 */
export function avatarUrl(uid: string | null | undefined, version?: string | null): string | null {
  const base = publicBase();
  if (!base || !uid || !SAFE_UID.test(uid)) return null;
  const stamp = version ? Date.parse(version) : Number.NaN;
  return `${base}/${avatarStoragePath(uid)}${Number.isFinite(stamp) ? `?v=${stamp}` : ""}`;
}

// ---- remembering pictures that failed to load (most students simply have none) -------------------------------------

const FAILED_RETRY_MS = 5 * 60 * 1000;
const failed = new Map<string, number>();

/** Called when an <img> could not load, so the same missing picture is not requested again and again while browsing. */
export function noteAvatarFailure(url: string): void {
  failed.set(url, Date.now());
}

/** True for a short while after a picture failed to load. After that it is tried again (the student may have added one). */
export function avatarRecentlyFailed(url: string): boolean {
  const at = failed.get(url);
  if (at === undefined) return false;
  if (Date.now() - at < FAILED_RETRY_MS) return true;
  failed.delete(url);
  return false;
}

export function forgetAvatarFailures(): void {
  failed.clear();
}

// ---- choosing and preparing a picture -----------------------------------------------------------------------------

/**
 * Friendly pre-check so students get quick feedback. Looks at the REAL bytes, not the file name or MIME type.
 * The server repeats every check and is the real gate.
 */
export async function validateAvatarFile(file: Pick<File, "size" | "slice"> | null | undefined): Promise<string | null> {
  if (!file) return "Please choose a picture.";
  if (file.size === 0) return "That file is empty. Please choose another picture.";
  if (file.size > AVATAR_INPUT_MAX_BYTES) return `That picture is too large. Please choose one under ${AVATAR_INPUT_MAX_LABEL}.`;
  let header: Uint8Array;
  try {
    header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return "That file couldn't be read. Please choose another picture.";
  }
  return detectImageType(header) === null ? "Please choose a JPG, PNG or WebP image." : null;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode failed"));
    image.src = url;
  });
}

const UNREADABLE = "That image couldn't be read. Please try another picture.";

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // fall through to the <img> route
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(UNREADABLE);
  }
}

/**
 * Checks the chosen file, then crops it to a centered square and shrinks it to at most 512 px as a JPEG, so even a large
 * phone photo ends up far below the 2 MB limit. A picture that can't be decoded as an image is refused here.
 */
export async function prepareAvatar(file: File): Promise<Blob> {
  const problem = await validateAvatarFile(file);
  if (problem) throw new Error(problem);
  const picture = await decode(file);
  try {
    const side = Math.min(picture.width, picture.height);
    if (!(side > 0)) throw new Error(UNREADABLE);
    const output = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = output;
    canvas.height = output;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(UNREADABLE);
    context.fillStyle = "#ffffff"; // transparent PNG/WebP areas become white instead of black
    context.fillRect(0, 0, output, output);
    context.drawImage(picture.source, (picture.width - side) / 2, (picture.height - side) / 2, side, side, 0, 0, output, output);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", AVATAR_JPEG_QUALITY));
    if (!blob || blob.size === 0) throw new Error(UNREADABLE);
    if (blob.size > AVATAR_MAX_BYTES) throw new Error("That picture is too large. Please choose another one.");
    return blob;
  } finally {
    picture.release();
  }
}

// ---- talking to the Edge Function ---------------------------------------------------------------------------------

/** Sends the prepared picture. Returns the stored path reported by the server. */
export async function uploadAvatar(idToken: string, image: Blob): Promise<string> {
  if (image.size === 0) throw new Error("That file is empty. Please choose another picture.");
  if (image.size > AVATAR_MAX_BYTES) throw new Error("That picture is too large. Please choose one under 2 MB.");
  const form = new FormData();
  form.append("file", image, "avatar.jpg");
  const body = await callFunction("profile-picture", idToken, { method: "POST", body: form });
  if (typeof body.path !== "string") throw new Error("The upload could not be confirmed. Please try again.");
  return body.path;
}

/** Removes the stored picture. Removing one that does not exist is not an error. */
export async function deleteAvatar(idToken: string): Promise<void> {
  await callFunction("profile-picture", idToken, { method: "DELETE" });
}

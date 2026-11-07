import { type ReactNode, useState } from "react";
import { avatarRecentlyFailed, avatarUrl, noteAvatarFailure } from "./data/avatarService";

/**
 * The inside of an avatar circle: the person's picture when they have one, otherwise `fallback` (their initials or an
 * icon). Put it inside whatever element already draws the circle. A picture that can't be loaded (most students have
 * none) quietly falls back, and isn't requested again for a few minutes.
 *
 * `skip` = "we already know there is no picture" (e.g. our own profile says photoPath is empty): no request is made.
 * `version` = the owner's photoUpdatedAt, which makes a replaced picture show up immediately for them.
 */
export function AvatarFace({ userId, version, skip = false, fallback }: { userId: string | null | undefined; version?: string | null; skip?: boolean; fallback: ReactNode }) {
  const src = skip ? null : avatarUrl(userId, version);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src || avatarRecentlyFailed(src)) return <>{fallback}</>;
  return <img className="avatar-img" src={src} alt="" loading="lazy" draggable={false} onError={() => { noteAvatarFailure(src); setFailedSrc(src); }} />;
}

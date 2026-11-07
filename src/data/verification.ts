import type { User } from "./types";

// UI-LEVEL checks only. These decide which buttons and screens to show, but
// they run in the browser and can be bypassed, so they are NOT security.
// Real enforcement must come from Firebase security rules that read the
// verification status from the server-side users/{uid} document (see
// firestore.rules). Until listings and messages move to Firestore, the local
// prototype data cannot be protected by rules.

/**
 * Firebase accounts must be "approved". Prototype accounts created before
 * Phase 4A have no verificationStatus at all and keep working as before.
 * A Firebase account always has a status (missing data is treated as
 * "pending"), so nobody is auto-approved.
 */
export function canUseMarketplace(user: User | null | undefined): boolean {
  if (!user) return false;
  return user.verificationStatus === undefined || user.verificationStatus === "approved";
}

export function verificationLabel(user: User): string {
  switch (user.verificationStatus) {
    case "approved": return "Verified student";
    case "pending": return "Pending verification";
    case "rejected": return "Verification rejected";
    default: return "Campus account";
  }
}

/** Explains why marketplace actions are locked. Empty when they are not. */
export function verificationNotice(user: User): string {
  if (user.verificationStatus === "pending") {
    return "Your account is pending student verification. You can browse and save items, but listing and messaging unlock once your Certificate of Registration is approved.";
  }
  if (user.verificationStatus === "rejected") {
    return "Your student verification was not approved, so listing and messaging are unavailable. You can upload a corrected Certificate of Registration on your Profile page.";
  }
  return "";
}

import type { Listing, ListingCategory } from "./types";

// Pure helpers shared by the local and Firestore listing backends. They live in their own file so the
// Firestore module can use them without importing listingService (which would create an import cycle).
// listingService.ts re-exports all of them, so existing imports keep working.

/** True once the seller marked the listing as sold. Listings without a status are available. */
export function isSold(listing: Pick<Listing, "status">): boolean {
  return listing.status === "sold";
}

/** "Juan Dela Cruz" -> "Juan C." to match the existing card style. */
export function formatSellerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "Student";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function formatPrice(price: number): string {
  if (price >= 1_000_000 && price % 1_000_000 === 0) return `₱${price / 1_000_000}M`;
  return `₱${price.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

/** Accepts "₱ 1,250.50", "250", etc. Returns null if it isn't a valid price. */
export function parsePrice(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function formatPostedAt(createdAt: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(createdAt).getTime()) / 86_400_000);
  if (!(days > 0)) return "Posted today";
  return days === 1 ? "Posted yesterday" : `Posted ${days} days ago`;
}

/** Which placeholder artwork a listing without photos should use. */
export function artKind(category: ListingCategory): "book" | "uniform" | "tools" {
  return category === "Books" ? "book" : category === "Uniforms" ? "uniform" : "tools";
}

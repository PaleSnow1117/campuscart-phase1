import {
  getSavedIds,
  getStoredListings,
  removeSavedIdEverywhere,
  saveSavedIds,
  saveStoredListings,
} from "./storage";
import type {
  Listing,
  ListingCategory,
  ListingFilters,
  NewListingInput,
  User,
} from "./types";

const SEED_CAMPUS = "URS Binangonan";

// First-run content only: written to localStorage once, then never touched.
const seedListings: Listing[] = [
  {
    id: "seed-1", title: "URS P.E UNIFORM", price: 1_000_000, condition: "Good as new",
    category: "Uniforms", sellerId: "seed-seller-1", sellerName: "Balmond R.", images: [],
    description: "Complete URS P.E uniform in excellent condition. Clean, comfortable, and ready to use. Meet-up inside campus preferred.",
    campus: SEED_CAMPUS, createdAt: new Date().toISOString(),
  },
  {
    id: "seed-2", title: "CALCULUS BOOK", price: 250, condition: "Good as new",
    category: "Books", sellerId: "seed-seller-2", sellerName: "Miya S.", images: [],
    description: "Calculus textbook with clean pages and no missing sections. Meet-up inside campus preferred.",
    campus: SEED_CAMPUS, createdAt: new Date().toISOString(),
  },
  {
    id: "seed-3", title: "DRAFTING SET", price: 180, condition: "Lightly used",
    category: "Other", sellerId: "seed-seller-3", sellerName: "Clint M.", images: [],
    description: "Drafting set with all main pieces included. Lightly used and still in working condition.",
    campus: SEED_CAMPUS, createdAt: new Date().toISOString(),
  },
];

/** "Juan Dela Cruz" -> "Juan C." to match the existing card style. */
export function formatSellerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "Student";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function makeId(): string {
  return `listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export const listingService = {
  getAll(): Listing[] {
    const stored = getStoredListings();
    if (stored) return stored;
    saveStoredListings(seedListings);
    return seedListings;
  },

  getById(id: string | null | undefined): Listing | undefined {
    return id ? this.getAll().find((listing) => listing.id === id) : undefined;
  },

  /** Newest first. Throws a readable Error if storage is full. */
  create(input: NewListingInput, seller: User): Listing {
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) throw new Error("Please fill in all fields.");
    if (!(input.price >= 0)) throw new Error("Please enter a valid price.");
    const listing: Listing = {
      id: makeId(), title, description,
      price: input.price, condition: input.condition, category: input.category,
      sellerId: seller.id, sellerName: formatSellerName(seller.fullName),
      images: input.images, campus: seller.campus, createdAt: new Date().toISOString(),
    };
    try {
      saveStoredListings([listing, ...this.getAll()]);
    } catch {
      throw new Error("Not enough browser storage for these photos. Try fewer or smaller photos.");
    }
    return listing;
  },

  /** Edits a listing the user owns. Seller, campus and posted date stay as they were. */
  update(id: string, input: NewListingInput, user: User): Listing {
    const all = this.getAll();
    const current = all.find((listing) => listing.id === id);
    if (!current || current.sellerId !== user.id) throw new Error("You can only edit your own listings.");
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) throw new Error("Please fill in all fields.");
    if (!(input.price >= 0)) throw new Error("Please enter a valid price.");
    const updated: Listing = {
      ...current, title, description,
      price: input.price, condition: input.condition, category: input.category, images: input.images,
    };
    try {
      saveStoredListings(all.map((listing) => (listing.id === id ? updated : listing)));
    } catch {
      throw new Error("Not enough browser storage for these photos. Try fewer or smaller photos.");
    }
    return updated;
  },

  /** Deletes a listing the user owns and drops it from every saved list. */
  remove(id: string, user: User): void {
    const all = this.getAll();
    const current = all.find((listing) => listing.id === id);
    if (!current || current.sellerId !== user.id) throw new Error("You can only delete your own listings.");
    saveStoredListings(all.filter((listing) => listing.id !== id));
    removeSavedIdEverywhere(id);
  },

  /** Keeps the seller name on a user's listings in step with their profile. */
  syncSellerName(user: User): void {
    const all = this.getAll();
    const name = formatSellerName(user.fullName);
    if (!all.some((listing) => listing.sellerId === user.id && listing.sellerName !== name)) return;
    saveStoredListings(all.map((listing) => (listing.sellerId === user.id ? { ...listing, sellerName: name } : listing)));
  },

  /** Pure helper: the listings a given user posted. */
  forSeller(listings: Listing[], sellerId: string): Listing[] {
    return listings.filter((listing) => listing.sellerId === sellerId);
  },

  /** Pure filter so UI components stay free of matching logic. */
  filter(listings: Listing[], { category = "All", query = "" }: ListingFilters): Listing[] {
    const text = query.toLowerCase().trim();
    return listings.filter((listing) => {
      if (category !== "All" && listing.category !== category) return false;
      return !text || [listing.title, listing.condition, listing.sellerName, listing.category, listing.description]
        .some((field) => field.toLowerCase().includes(text));
    });
  },
};

// Saved items are stored per account (guests share one bucket).
const GUEST = "guest";

export const savedService = {
  getIds(userId?: string | null): string[] {
    return getSavedIds(userId ?? GUEST);
  },
  toggle(userId: string | null | undefined, listingId: string): string[] {
    const owner = userId ?? GUEST;
    const current = getSavedIds(owner);
    const next = current.includes(listingId)
      ? current.filter((id) => id !== listingId)
      : [...current, listingId];
    saveSavedIds(owner, next);
    return next;
  },
};
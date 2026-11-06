export type VerificationStatus = "pending" | "approved" | "rejected";

export type User = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  campus: string;
  createdAt: string;
  /* Student verification (Firebase accounts). All optional so the local
     prototype accounts from Phases 2-3.5 keep working untouched. */
  studentNumber?: string;
  verificationStatus?: VerificationStatus;
  /** Path of the private COR in Firebase Storage (never a download URL). */
  corStoragePath?: string | null;
  verifiedAt?: string | null;
  /** When the administrator approved or rejected the request. */
  reviewedAt?: string | null;
};

export const DEFAULT_CAMPUS = "URS Binangonan";

export const LISTING_CATEGORIES = ["Books", "Uniforms", "Food", "Other"] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CONDITIONS = ["Good as new", "Brand new", "Lightly used"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

/** Campuses a user can pick from in Profile > Campus. */
export const CAMPUSES = [
  "URS Angono", "URS Antipolo", "URS Binangonan", "URS Cainta", "URS Cardona",
  "URS Morong", "URS Pililla", "URS Rodriguez", "URS Tanay", "URS Taytay",
] as const;

/** The parts of a User that can be edited from the Profile screens. */
export type ProfileChanges = Partial<Pick<User, "fullName" | "username" | "email" | "campus">>;

export type Listing = {
  id: string;
  title: string;
  /** Price in pesos. Use formatPrice() from listingService to display it. */
  price: number;
  condition: ListingCondition;
  category: ListingCategory;
  description: string;
  sellerId: string;
  sellerName: string;
  /** Data URLs stored inside the listing document (at most 5, about 900 KB in total). */
  images: string[];
  campus: string;
  createdAt: string;
};

export type NewListingInput = {
  title: string;
  price: number;
  condition: ListingCondition;
  category: ListingCategory;
  description: string;
  images: string[];
};

export type ListingFilters = {
  category?: ListingCategory | "All";
  query?: string;
};

export type Conversation = {
  id: string;
  listingId: string;
  /** Snapshots so a conversation still renders if the listing changes. */
  listingTitle: string;
  listingPrice: number;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
};

/** Stops a live subscription. */
export type Unsubscribe = () => void;

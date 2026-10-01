export type User = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  campus: string;
  createdAt: string;
};

export const LISTING_CATEGORIES = ["Books", "Uniforms", "Food", "Other"] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CONDITIONS = ["Good as new", "Brand new", "Lightly used"] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

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
  /** Data URLs (local-only for now). */
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

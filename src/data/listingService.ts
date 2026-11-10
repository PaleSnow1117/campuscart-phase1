import { isFirebaseConfigured } from "./firebase";
import { firestoreListings, firestoreSaved } from "./firestoreMarketplace";
import { formatSellerName, isSold } from "./listingHelpers";
import { localBus } from "./localBus";
import {
  getSavedIds,
  getStoredListings,
  removeSavedIdEverywhere,
  saveSavedIds,
  saveStoredListings,
} from "./storage";
import { canUseMarketplace, verificationNotice } from "./verification";
import type {
  Listing,
  ListingFilters,
  NewListingInput,
  Unsubscribe,
  User,
} from "./types";

// Listings and saved items. When Firebase is configured they live in Firestore (firestoreMarketplace.ts) and
// NOTHING is read from or written to localStorage. Without Firebase (plain local development) the original
// localStorage prototype below keeps working, including its demo listings. The two are never mixed.

// The pure helpers moved to listingHelpers.ts; they are re-exported so existing imports keep working.
export { artKind, formatPostedAt, formatPrice, formatSellerName, isSold, parsePrice } from "./listingHelpers";

type OnError = (error: unknown) => void;

type ListingBackend = {
  subscribe(onData: (items: Listing[]) => void, onError: OnError): Unsubscribe;
  create(input: NewListingInput, seller: User): Promise<Listing>;
  update(id: string, input: NewListingInput, user: User): Promise<void>;
  markSold(id: string, user: User | null): Promise<void>;
  remove(id: string, user: User): Promise<void>;
  syncSellerName(user: User): Promise<void>;
};

type SavedBackend = {
  subscribe(userId: string | null, onData: (ids: string[]) => void, onError: OnError): Unsubscribe;
  set(userId: string | null, listingId: string, save: boolean): Promise<void>;
  pruneMissing(userId: string, savedIds: string[]): Promise<void>;
};

// ---- local (localStorage) backend: the original prototype, used only when Firebase is not configured ----

const SEED_CAMPUS = "URS Binangonan";

// Demo content for LOCAL mode only: written to localStorage once, then never touched.
// It is never uploaded to Firestore and never shown when Firebase is configured.
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

function makeId(): string {
  return `listing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLocalListings(): Listing[] {
  const stored = getStoredListings();
  if (stored) return stored;
  saveStoredListings(seedListings);
  return seedListings;
}

/** Calls onData once (asynchronously) and again after every local change. */
function localSubscribe<T>(read: () => T, onData: (value: T) => void, onError: OnError): Unsubscribe {
  let active = true;
  const emit = () => {
    if (!active) return;
    try { onData(read()); } catch (error) { onError(error); }
  };
  queueMicrotask(emit);
  const off = localBus.subscribe(emit);
  return () => { active = false; off(); };
}

const localListings: ListingBackend = {
  subscribe: (onData, onError) => localSubscribe(readLocalListings, onData, onError),

  /** Newest first. Throws a readable Error if storage is full. */
  async create(input, seller) {
    if (!canUseMarketplace(seller)) throw new Error(verificationNotice(seller));
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) throw new Error("Please fill in all fields.");
    if (!(input.price >= 0)) throw new Error("Please enter a valid price.");
    const listing: Listing = {
      id: makeId(), title, description,
      price: input.price, condition: input.condition, category: input.category,
      sellerId: seller.id, sellerName: formatSellerName(seller.fullName),
      images: input.images, campus: seller.campus, createdAt: new Date().toISOString(), status: "available",
    };
    try {
      saveStoredListings([listing, ...readLocalListings()]);
    } catch {
      throw new Error("Not enough browser storage for these photos. Try fewer or smaller photos.");
    }
    localBus.notify();
    return listing;
  },

  /** Edits a listing the user owns. Seller, campus and posted date stay as they were. */
  async update(id, input, user) {
    const all = readLocalListings();
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
    localBus.notify();
  },

  /** Mark as Sold: only the owner, only an available listing. Everything else about the listing stays as it was. */
  async markSold(id, user) {
    if (!user) throw new Error("Please log in to mark an item as sold.");
    const all = readLocalListings();
    const current = all.find((listing) => listing.id === id);
    if (!current || current.sellerId !== user.id) throw new Error("You can only mark your own listings as sold.");
    if (isSold(current)) throw new Error("This item is already marked as sold.");
    saveStoredListings(all.map((listing) => (listing.id === id ? { ...listing, status: "sold" } : listing)));
    localBus.notify();
  },

  /** Deletes a listing the user owns and drops it from every saved list. */
  async remove(id, user) {
    const all = readLocalListings();
    const current = all.find((listing) => listing.id === id);
    if (!current || current.sellerId !== user.id) throw new Error("You can only delete your own listings.");
    saveStoredListings(all.filter((listing) => listing.id !== id));
    removeSavedIdEverywhere(id);
    localBus.notify();
  },

  /** Keeps the seller name on a user's listings in step with their profile. */
  async syncSellerName(user) {
    const all = readLocalListings();
    const name = formatSellerName(user.fullName);
    if (!all.some((listing) => listing.sellerId === user.id && listing.sellerName !== name)) return;
    saveStoredListings(all.map((listing) => (listing.sellerId === user.id ? { ...listing, sellerName: name } : listing)));
    localBus.notify();
  },
};

// Saved items are stored per account (local guests share one bucket).
const GUEST = "guest";

const localSaved: SavedBackend = {
  subscribe: (userId, onData, onError) => localSubscribe(() => getSavedIds(userId ?? GUEST), onData, onError),
  async set(userId, listingId, save) {
    const owner = userId ?? GUEST;
    const current = getSavedIds(owner);
    const without = current.filter((id) => id !== listingId);
    saveSavedIds(owner, save ? [...without, listingId] : without);
    localBus.notify();
  },
  async pruneMissing() {
    // Local deletes already clean every saved list (removeSavedIdEverywhere).
  },
};

// ---- public API ----------------------------------------------------------------------------------------------

const backend: ListingBackend = isFirebaseConfigured ? firestoreListings : localListings;
const savedBackend: SavedBackend = isFirebaseConfigured ? firestoreSaved : localSaved;

export const listingService = {
  /** Live listings. In Firebase mode only signed-in users may read them. */
  subscribe: backend.subscribe,
  create: backend.create,
  update: backend.update,
  /** Mark as Sold (owner only). The listing stays in Saved finds and in existing conversations, labelled SOLD. */
  markSold: backend.markSold,
  remove: backend.remove,
  syncSellerName: backend.syncSellerName,

  /** Pure helper: the listings a given user posted. */
  forSeller(listings: Listing[], sellerId: string): Listing[] {
    return listings.filter((listing) => listing.sellerId === sellerId);
  },

  /** Pure filter so UI components stay free of matching logic. Sold items are left out unless `status` asks for them. */
  filter(listings: Listing[], { category = "All", query = "", status = "available" }: ListingFilters): Listing[] {
    const text = query.toLowerCase().trim();
    return listings.filter((listing) => {
      if (status !== "all" && (status === "sold") !== isSold(listing)) return false;
      if (category !== "All" && listing.category !== category) return false;
      return !text || [listing.title, listing.condition, listing.sellerName, listing.category, listing.description]
        .some((field) => field.toLowerCase().includes(text));
    });
  },
};

export const savedService = {
  /** Firebase mode: the signed-in user's saved ids, synced across devices. Local mode: this browser only. */
  subscribe: savedBackend.subscribe,
  /** Saves (save = true) or un-saves a listing. */
  set: savedBackend.set,
  /** Removes saved ids whose listing the server confirms is gone. */
  pruneMissing: savedBackend.pruneMissing,
};

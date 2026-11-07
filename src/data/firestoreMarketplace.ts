import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { getFirebase } from "./firebase";
import { formatSellerName } from "./listingHelpers";
import {
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  type Conversation,
  type Listing,
  type Message,
  type NewListingInput,
  type UnreadEntry,
  type Unsubscribe,
  type User,
} from "./types";
import { canUseMarketplace, verificationNotice } from "./verification";

// Firestore-backed marketplace data. Used instead of the localStorage backend whenever Firebase is configured.
//
//   listings/{listingId}                          one document per listing
//   users/{uid}/saved/{listingId}                 one document per saved listing (private to that user)
//   conversations/{listingId}_{buyerUid}          ONE conversation per listing + buyer (the id enforces it)
//   conversations/{id}/messages/{messageId}       the messages of that conversation
//   users/{recipientUid}/unread/{messageId}       ONE marker per unread message (created with the message, removed when read)
//
// Everything here is ALSO enforced by firestore.rules. The checks in this file give friendly errors early;
// they are not the security boundary.

export const LISTINGS_LIMIT = 100; // newest listings shown; see "Known limitations" in the setup guide
export const MAX_MESSAGE_LENGTH = 1000;
/** The unread listener never reads more than this many markers (the badge shows "99+" beyond 99). */
export const UNREAD_LIMIT = 100;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_PRICE = 1_000_000_000;
export const MAX_LISTING_IMAGES = 5;
/** Total characters of all photo data URLs in one listing. A Firestore document may not exceed 1 MiB. */
export const MAX_IMAGE_CHARS_TOTAL = 900_000;

type OnError = (error: unknown) => void;

// ---- mapping (pure, exported for tests) ------------------------------------------------------------------

function toIso(value: unknown): string {
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString(); // a local write whose server time has not been assigned yet
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Returns null for malformed documents so one bad document can never break the whole list. */
export function toListing(id: string, data: DocumentData): Listing | null {
  if (typeof data.title !== "string" || !data.title || typeof data.price !== "number" || !Number.isFinite(data.price) || typeof data.sellerId !== "string") return null;
  return {
    id,
    title: data.title,
    price: data.price,
    condition: LISTING_CONDITIONS.find((entry) => entry === data.condition) ?? "Good as new",
    category: LISTING_CATEGORIES.find((entry) => entry === data.category) ?? "Other",
    description: text(data.description),
    sellerId: data.sellerId,
    sellerName: text(data.sellerName) || "Student",
    images: Array.isArray(data.images) ? data.images.filter((entry): entry is string => typeof entry === "string") : [],
    campus: text(data.campus),
    createdAt: toIso(data.createdAt),
  };
}

export function toConversation(id: string, data: DocumentData): Conversation | null {
  if (typeof data.listingId !== "string" || typeof data.buyerId !== "string" || typeof data.sellerId !== "string") return null;
  return {
    id,
    listingId: data.listingId,
    listingTitle: text(data.listingTitle),
    listingPrice: typeof data.listingPrice === "number" ? data.listingPrice : 0,
    buyerId: data.buyerId,
    buyerName: text(data.buyerName) || "Student",
    sellerId: data.sellerId,
    sellerName: text(data.sellerName) || "Student",
    lastMessage: text(data.lastMessage),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export function toMessage(id: string, conversationId: string, data: DocumentData): Message | null {
  if (typeof data.senderId !== "string" || typeof data.text !== "string") return null;
  return { id, conversationId, senderId: data.senderId, text: data.text, createdAt: toIso(data.createdAt), editedAt: data.editedAt ? toIso(data.editedAt) : null };
}

export function toUnreadEntry(messageId: string, data: DocumentData): UnreadEntry | null {
  return typeof data.conversationId === "string" && data.conversationId ? { messageId, conversationId: data.conversationId } : null;
}

const notNull = <T>(value: T | null): value is T => value !== null;
const readOptions = { serverTimestamps: "estimate" } as const;

export function conversationIdFor(listingId: string, buyerId: string): string {
  return `${listingId}_${buyerId}`;
}

// ---- validation (friendly early errors; the rules repeat all of it) -------------------------------------

export function validateListingInput(input: NewListingInput): { title: string; description: string } {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) throw new Error("Please fill in all fields.");
  if (title.length > MAX_TITLE_LENGTH) throw new Error(`The title can be up to ${MAX_TITLE_LENGTH} characters.`);
  if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`The description can be up to ${MAX_DESCRIPTION_LENGTH.toLocaleString("en-US")} characters.`);
  if (!(input.price >= 0) || input.price > MAX_PRICE) throw new Error("Please enter a valid price.");
  if (input.images.length > MAX_LISTING_IMAGES || input.images.reduce((sum, image) => sum + image.length, 0) > MAX_IMAGE_CHARS_TOTAL) {
    throw new Error("These photos are too large to save. Try fewer or smaller photos.");
  }
  return { title, description };
}

function requireVerified(user: User | null, signedOutMessage: string): User {
  if (!user) throw new Error(signedOutMessage);
  if (!canUseMarketplace(user)) throw new Error(verificationNotice(user));
  return user;
}

// ---- listings ----------------------------------------------------------------------------------------------

export const firestoreListings = {
  /** Live list of the newest listings. Only signed-in users may read them (see the rules). */
  subscribe(onData: (items: Listing[]) => void, onError: OnError): Unsubscribe {
    const { db } = getFirebase();
    const newest = query(collection(db, "listings"), orderBy("createdAt", "desc"), limit(LISTINGS_LIMIT));
    return onSnapshot(
      newest,
      (snapshot) => onData(snapshot.docs.map((entry) => toListing(entry.id, entry.data(readOptions))).filter(notNull)),
      onError,
    );
  },

  /** The seller, seller name and campus come from the signed-in profile; the rules check them again. */
  async create(input: NewListingInput, seller: User): Promise<Listing> {
    requireVerified(seller, "Please log in to publish a listing.");
    const { title, description } = validateListingInput(input);
    const { db } = getFirebase();
    const ref = doc(collection(db, "listings"));
    const sellerName = formatSellerName(seller.fullName);
    await setDoc(ref, {
      title, description,
      price: input.price,
      condition: input.condition,
      category: input.category,
      images: input.images,
      sellerId: seller.id,
      sellerName,
      campus: seller.campus,
      createdAt: serverTimestamp(),
    });
    return {
      id: ref.id, title, description, price: input.price, condition: input.condition, category: input.category,
      images: input.images, sellerId: seller.id, sellerName, campus: seller.campus, createdAt: new Date().toISOString(),
    };
  },

  /** Seller, campus and posted date can never change (enforced by the rules). */
  async update(id: string, input: NewListingInput, user: User): Promise<void> {
    requireVerified(user, "Please log in to edit a listing.");
    const { title, description } = validateListingInput(input);
    const { db } = getFirebase();
    await updateDoc(doc(db, "listings", id), {
      title, description, price: input.price, condition: input.condition, category: input.category, images: input.images,
    });
  },

  async remove(id: string, user: User | null): Promise<void> {
    if (!user) throw new Error("Please log in to delete a listing.");
    await deleteDoc(doc(getFirebase().db, "listings", id));
  },

  /** Keeps the seller name on a user's listings in step with their profile. */
  async syncSellerName(user: User): Promise<void> {
    const { db } = getFirebase();
    const name = formatSellerName(user.fullName);
    const mine = await getDocs(query(collection(db, "listings"), where("sellerId", "==", user.id)));
    const stale = mine.docs.filter((entry) => entry.data().sellerName !== name).slice(0, 400);
    if (!stale.length) return;
    const batch = writeBatch(db);
    stale.forEach((entry) => batch.update(entry.ref, { sellerName: name }));
    await batch.commit();
  },
};

// ---- saved items -------------------------------------------------------------------------------------------

export const firestoreSaved = {
  /** Live list of the signed-in user's saved listing ids. There is no server data for guests. */
  subscribe(userId: string | null, onData: (ids: string[]) => void, onError: OnError): Unsubscribe {
    if (!userId) {
      let active = true;
      queueMicrotask(() => { if (active) onData([]); });
      return () => { active = false; };
    }
    const { db } = getFirebase();
    return onSnapshot(collection(db, "users", userId, "saved"), (snapshot) => onData(snapshot.docs.map((entry) => entry.id)), onError);
  },

  async set(userId: string | null, listingId: string, save: boolean): Promise<void> {
    if (!userId) throw new Error("Please log in to save items.");
    const ref = doc(getFirebase().db, "users", userId, "saved", listingId);
    if (save) await setDoc(ref, { listingId, savedAt: serverTimestamp() });
    else await deleteDoc(ref);
  },

  /**
   * A seller deleting a listing cannot touch other people's saved lists (that is the isolation we want).
   * Instead each user cleans up their own dangling ids: an id is removed only when the SERVER confirms
   * the listing no longer exists. Network errors never delete anything.
   */
  async pruneMissing(userId: string, savedIds: string[]): Promise<void> {
    const { db } = getFirebase();
    for (const listingId of savedIds.slice(0, 50)) {
      try {
        const listing = await getDocFromServer(doc(db, "listings", listingId));
        if (!listing.exists()) await deleteDoc(doc(db, "users", userId, "saved", listingId));
      } catch {
        // offline or no permission: leave it alone and try again next time
      }
    }
  },
};

// ---- conversations and messages --------------------------------------------------------------------------

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

/** The other person in a conversation (participants never change). Undefined if it can't be determined. */
async function otherParticipant(conversationRef: DocumentReference, userId: string): Promise<string | undefined> {
  const snapshot = await getDoc(conversationRef);
  const participants: unknown = snapshot.exists() ? snapshot.data().participants : undefined;
  return Array.isArray(participants) ? participants.find((id): id is string => typeof id === "string" && id !== userId) : undefined;
}

export const firestoreMessages = {
  /** The signed-in user's conversations (as buyer or seller), most recently active first. */
  subscribeConversations(userId: string, onData: (items: Conversation[]) => void, onError: OnError): Unsubscribe {
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, "conversations"), where("participants", "array-contains", userId)),
      (snapshot) => onData(
        snapshot.docs
          .map((entry) => toConversation(entry.id, entry.data(readOptions)))
          .filter(notNull)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ),
      onError,
    );
  },

  /** Calls back with null when the conversation doesn't exist or the user isn't part of it. */
  subscribeConversation(conversationId: string, onData: (item: Conversation | null) => void, onError: OnError): Unsubscribe {
    const { db } = getFirebase();
    return onSnapshot(
      doc(db, "conversations", conversationId),
      (snapshot) => onData(snapshot.exists() ? toConversation(snapshot.id, snapshot.data(readOptions)) : null),
      (error) => { if (codeOf(error) === "permission-denied") onData(null); else onError(error); },
    );
  },

  /** Oldest first. */
  subscribeMessages(conversationId: string, onData: (items: Message[]) => void, onError: OnError): Unsubscribe {
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, "conversations", conversationId, "messages"), orderBy("createdAt", "asc")),
      (snapshot) => onData(snapshot.docs.map((entry) => toMessage(entry.id, conversationId, entry.data(readOptions))).filter(notNull)),
      onError,
    );
  },

  /** One conversation per listing + buyer. The seller always comes from the listing itself. */
  async getOrCreateConversation(listing: Listing, buyer: User | null): Promise<Conversation> {
    const signedIn = requireVerified(buyer, "Please log in to message the seller.");
    if (signedIn.id === listing.sellerId) throw new Error("This is your own listing.");
    const { db } = getFirebase();
    const id = conversationIdFor(listing.id, signedIn.id);
    const ref = doc(db, "conversations", id);
    const existing = await getDocFromServer(ref);
    if (existing.exists()) {
      const found = toConversation(existing.id, existing.data());
      if (found) return found;
    }
    const buyerName = formatSellerName(signedIn.fullName);
    try {
      await setDoc(ref, {
        listingId: listing.id,
        listingTitle: listing.title,
        listingPrice: listing.price,
        buyerId: signedIn.id,
        buyerName,
        sellerId: listing.sellerId,
        sellerName: listing.sellerName,
        participants: [signedIn.id, listing.sellerId],
        lastMessage: "",
        lastMessageId: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (failure) {
      // Created a moment ago from another device? Then it exists now and we simply open it.
      const raced = await getDocFromServer(ref).catch(() => null);
      const found = raced?.exists() ? toConversation(raced.id, raced.data()) : null;
      if (found) return found;
      throw failure;
    }
    const now = new Date().toISOString();
    return {
      id, listingId: listing.id, listingTitle: listing.title, listingPrice: listing.price, buyerId: signedIn.id, buyerName,
      sellerId: listing.sellerId, sellerName: listing.sellerName, lastMessage: "", createdAt: now, updatedAt: now,
    };
  },

  /**
   * The message, the conversation's latest-message fields and the recipient's unread marker are written in ONE batch,
   * so they can't drift apart (a message is never unread-less, and a marker never exists without its message).
   * `recipientId` is the other participant; when the caller doesn't know it, it is read from the conversation.
   */
  async send(conversationId: string, sender: User | null, rawText: string, recipientId?: string): Promise<void> {
    const user = requireVerified(sender, "Please log in to send messages.");
    const body = rawText.trim();
    if (!body) throw new Error("Please write a message first.");
    if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
    const { db } = getFirebase();
    const conversationRef = doc(db, "conversations", conversationId);
    const recipient = recipientId ?? (await otherParticipant(conversationRef, user.id));
    if (!recipient || recipient === user.id) throw new Error("This conversation is not available.");
    const messageRef = doc(collection(conversationRef, "messages"));
    const batch = writeBatch(db);
    batch.set(messageRef, { conversationId, senderId: user.id, text: body, createdAt: serverTimestamp() });
    batch.update(conversationRef, { lastMessage: body, lastMessageId: messageRef.id, updatedAt: serverTimestamp() });
    batch.set(doc(db, "users", recipient, "unread", messageRef.id), { conversationId, senderId: user.id, createdAt: serverTimestamp() });
    await batch.commit();
  },

  /**
   * Edits the sender's OWN message. If it is the conversation's latest message, the preview follows the new text in
   * the same transaction. The rules repeat every check (sender, 1-1000 characters, only text and editedAt change).
   */
  async edit(conversationId: string, messageId: string, editor: User | null, rawText: string): Promise<void> {
    const user = requireVerified(editor, "Please log in to edit messages.");
    const body = rawText.trim();
    if (!body) throw new Error("Please write a message first.");
    if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
    const { db } = getFirebase();
    const conversationRef = doc(db, "conversations", conversationId);
    const messageRef = doc(conversationRef, "messages", messageId);
    await runTransaction(db, async (transaction) => {
      const message = await transaction.get(messageRef);
      if (!message.exists()) throw new Error("That message is no longer available.");
      if (message.data().senderId !== user.id) throw new Error("You can only edit your own messages.");
      const conversation = await transaction.get(conversationRef);
      transaction.update(messageRef, { text: body, editedAt: serverTimestamp() });
      if (conversation.exists() && conversation.data().lastMessageId === messageId) transaction.update(conversationRef, { lastMessage: body });
    });
  },

  /**
   * Deletes the sender's OWN message (only that one). If it was the latest message, the conversation preview moves to
   * the newest remaining message (or becomes empty), with updatedAt matching that message, in the same transaction.
   * A message that is already gone counts as deleted.
   */
  async remove(conversationId: string, messageId: string, user: User | null): Promise<void> {
    if (!user) throw new Error("Please log in to delete messages.");
    const { db } = getFirebase();
    const conversationRef = doc(db, "conversations", conversationId);
    const messageRef = doc(conversationRef, "messages", messageId);
    // Queries cannot run inside a transaction, so the newest remaining message is found first and re-checked inside it.
    const newest = await getDocs(query(collection(conversationRef, "messages"), orderBy("createdAt", "desc"), limit(3)));
    const candidate = newest.docs.find((entry) => entry.id !== messageId);
    await runTransaction(db, async (transaction) => {
      const message = await transaction.get(messageRef);
      if (!message.exists()) return; // already deleted
      if (message.data().senderId !== user.id) throw new Error("You can only delete your own messages.");
      const conversation = await transaction.get(conversationRef);
      const participants: unknown = conversation.exists() ? conversation.data().participants : undefined;
      const recipient = Array.isArray(participants) ? participants.find((id): id is string => typeof id === "string" && id !== user.id) : undefined;
      const wasLatest = conversation.exists() && conversation.data().lastMessageId === messageId;
      const replacement = wasLatest && candidate ? await transaction.get(candidate.ref) : null;
      if (wasLatest && candidate && !replacement?.exists()) throw new Error("The conversation changed. Please try again.");
      transaction.delete(messageRef);
      // The recipient must not keep counting a message that no longer exists. Deleting a marker that is already gone
      // (the message was read) does nothing, and the rules allow it.
      if (recipient) transaction.delete(doc(db, "users", recipient, "unread", messageId));
      if (!wasLatest || !conversation.exists()) return;
      if (replacement?.exists()) {
        const next = replacement.data();
        transaction.update(conversationRef, { lastMessage: next.text, lastMessageId: replacement.id, updatedAt: next.createdAt });
      } else {
        transaction.update(conversationRef, { lastMessage: "", lastMessageId: "", updatedAt: conversation.data().createdAt });
      }
    });
  },

  /** Keeps the stored names in step when a user edits their full name (each user can only change their own side). */
  async syncUserName(user: User): Promise<void> {
    const { db } = getFirebase();
    const name = formatSellerName(user.fullName);
    const mine = await getDocs(query(collection(db, "conversations"), where("participants", "array-contains", user.id)));
    const batch = writeBatch(db);
    let changes = 0;
    for (const entry of mine.docs.slice(0, 400)) {
      const data = entry.data();
      if (data.buyerId === user.id && data.buyerName !== name) { batch.update(entry.ref, { buyerName: name }); changes += 1; }
      else if (data.sellerId === user.id && data.sellerName !== name) { batch.update(entry.ref, { sellerName: name }); changes += 1; }
    }
    if (changes) await batch.commit();
  },

  /**
   * Live unread markers of the signed-in user, across ALL their conversations, from ONE listener on
   * users/{uid}/unread. Only unread messages are ever read (at most UNREAD_LIMIT), so reading costs nothing once
   * everything has been read. A message has exactly one marker (its id), so it can't be counted twice.
   */
  subscribeUnread(userId: string, onData: (items: UnreadEntry[]) => void, onError: OnError): Unsubscribe {
    const { db } = getFirebase();
    return onSnapshot(
      query(collection(db, "users", userId, "unread"), limit(UNREAD_LIMIT)),
      (snapshot) => onData(snapshot.docs.map((entry) => toUnreadEntry(entry.id, entry.data())).filter(notNull)),
      onError,
    );
  },

  /** Marks messages as read by removing their markers (in batches). Safe to repeat: markers already gone are ignored. */
  async markRead(userId: string, messageIds: string[]): Promise<void> {
    const ids = [...new Set(messageIds)];
    if (!ids.length) return;
    const { db } = getFirebase();
    for (let start = 0; start < ids.length; start += 400) {
      const batch = writeBatch(db);
      ids.slice(start, start + 400).forEach((id) => batch.delete(doc(db, "users", userId, "unread", id)));
      await batch.commit();
    }
  },
};

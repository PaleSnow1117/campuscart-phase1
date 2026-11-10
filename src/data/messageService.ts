import { isFirebaseConfigured } from "./firebase";
import { firestoreMessages } from "./firestoreMarketplace";
import { formatSellerName, isSold } from "./listingHelpers";
import { localBus } from "./localBus";
import type { Conversation, Listing, Message, UnreadEntry, Unsubscribe, User } from "./types";
import { canUseMarketplace, verificationNotice } from "./verification";

// Messaging. When Firebase is configured, conversations and messages live in Firestore and update live
// (firestoreMarketplace.ts); nothing is read from or written to localStorage. Without Firebase (plain local
// development) the original localStorage prototype below keeps working, with no live replies.

type OnError = (error: unknown) => void;

type MessageBackend = {
  subscribeConversations(userId: string, onData: (items: Conversation[]) => void, onError: OnError): Unsubscribe;
  subscribeConversation(conversationId: string, userId: string, onData: (item: Conversation | null) => void, onError: OnError): Unsubscribe;
  subscribeMessages(conversationId: string, userId: string, onData: (items: Message[]) => void, onError: OnError): Unsubscribe;
  getOrCreateConversation(listing: Listing, buyer: User | null): Promise<Conversation>;
  /** `recipientId` (the other participant) saves a lookup; it is worked out from the conversation when omitted. */
  send(conversationId: string, sender: User | null, text: string, recipientId?: string): Promise<void>;
  edit(conversationId: string, messageId: string, editor: User | null, text: string): Promise<void>;
  remove(conversationId: string, messageId: string, user: User | null): Promise<void>;
  syncUserName(user: User): Promise<void>;
  subscribeUnread(userId: string, onData: (items: UnreadEntry[]) => void, onError: OnError): Unsubscribe;
  markRead(userId: string, messageIds: string[]): Promise<void>;
};

// ---- local (localStorage) backend: used only when Firebase is not configured -----------------------------

const CONVERSATIONS_KEY = "campuscart.conversations";
const MESSAGES_KEY = "campuscart.messages";
const UNREAD_KEY = "campuscart.unread";
const MAX_MESSAGE_LENGTH = 1000;

function readList<T>(key: string, isValid: (entry: unknown) => entry is T): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter(isValid) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    throw new Error("Not enough browser storage to save this message.");
  }
}

const isRecord = (entry: unknown): entry is Record<string, unknown> =>
  typeof entry === "object" && entry !== null;

const isConversation = (entry: unknown): entry is Conversation =>
  isRecord(entry) &&
  typeof entry.id === "string" &&
  typeof entry.listingId === "string" &&
  typeof entry.buyerId === "string" &&
  typeof entry.sellerId === "string" &&
  typeof entry.updatedAt === "string";

const isMessage = (entry: unknown): entry is Message =>
  isRecord(entry) &&
  typeof entry.id === "string" &&
  typeof entry.conversationId === "string" &&
  typeof entry.senderId === "string" &&
  typeof entry.text === "string" &&
  typeof entry.createdAt === "string";

/** Local stand-in for users/{recipient}/unread/{messageId}: one marker per unread message. */
type LocalUnread = { messageId: string; conversationId: string; recipientId: string };

const isLocalUnread = (entry: unknown): entry is LocalUnread =>
  isRecord(entry) && typeof entry.messageId === "string" && typeof entry.conversationId === "string" && typeof entry.recipientId === "string";

const readUnread = () => readList(UNREAD_KEY, isLocalUnread);

const readConversations = () => readList(CONVERSATIONS_KEY, isConversation);
const readMessages = () => readList(MESSAGES_KEY, isMessage);

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const isParticipant = (conversation: Conversation, userId: string) =>
  conversation.buyerId === userId || conversation.sellerId === userId;

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

/** The signed-in user's conversations, most recently active first. */
function localConversations(userId: string): Conversation[] {
  return readConversations()
    .filter((conversation) => isParticipant(conversation, userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Undefined if it doesn't exist or the user isn't part of it. */
function localConversation(conversationId: string, userId: string): Conversation | undefined {
  return readConversations().find((conversation) => conversation.id === conversationId && isParticipant(conversation, userId));
}

/** Oldest first. Empty if the user isn't part of the conversation. */
function localMessages(conversationId: string, userId: string): Message[] {
  if (!localConversation(conversationId, userId)) return [];
  return readMessages()
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The newest message of a conversation (by time), or undefined. */
function newestMessage(messages: Message[], conversationId: string): Message | undefined {
  return messages
    .filter((entry) => entry.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

const localBackend: MessageBackend = {
  subscribeConversations: (userId, onData, onError) => localSubscribe(() => localConversations(userId), onData, onError),
  subscribeConversation: (conversationId, userId, onData, onError) =>
    localSubscribe(() => localConversation(conversationId, userId) ?? null, onData, onError),
  subscribeMessages: (conversationId, userId, onData, onError) =>
    localSubscribe(() => localMessages(conversationId, userId), onData, onError),

  /** One conversation per buyer + seller + listing; reuses it if it exists. */
  async getOrCreateConversation(listing, buyer) {
    if (!buyer) throw new Error("Please log in to message the seller.");
    if (!canUseMarketplace(buyer)) throw new Error(verificationNotice(buyer));
    if (buyer.id === listing.sellerId) throw new Error("This is your own listing.");
    const conversations = readConversations();
    const existing = conversations.find(
      (conversation) =>
        conversation.buyerId === buyer.id &&
        conversation.sellerId === listing.sellerId &&
        conversation.listingId === listing.id,
    );
    if (existing) return existing; // an existing conversation stays available, even after the item was sold
    if (isSold(listing)) throw new Error("This item has been sold.");
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: makeId("conv"),
      listingId: listing.id,
      listingTitle: listing.title,
      listingPrice: listing.price,
      buyerId: buyer.id,
      buyerName: formatSellerName(buyer.fullName),
      sellerId: listing.sellerId,
      sellerName: listing.sellerName,
      lastMessage: "",
      createdAt: now,
      updatedAt: now,
    };
    writeList(CONVERSATIONS_KEY, [...conversations, conversation]);
    localBus.notify();
    return conversation;
  },

  async send(conversationId, sender, text) {
    if (!sender) throw new Error("Please log in to send messages.");
    if (!canUseMarketplace(sender)) throw new Error(verificationNotice(sender));
    const body = text.trim();
    if (!body) throw new Error("Please write a message first.");
    if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
    const conversations = readConversations();
    const conversation = conversations.find((entry) => entry.id === conversationId);
    if (!conversation || !isParticipant(conversation, sender.id)) {
      throw new Error("This conversation is not available.");
    }
    const now = new Date().toISOString();
    const message: Message = {
      id: makeId("msg"),
      conversationId,
      senderId: sender.id,
      text: body,
      createdAt: now,
    };
    const recipientId = conversation.buyerId === sender.id ? conversation.sellerId : conversation.buyerId;
    writeList(MESSAGES_KEY, [...readMessages(), message]);
    writeList(UNREAD_KEY, [...readUnread(), { messageId: message.id, conversationId, recipientId }]);
    writeList(
      CONVERSATIONS_KEY,
      conversations.map((entry) =>
        entry.id === conversationId ? { ...entry, lastMessage: body, updatedAt: now } : entry,
      ),
    );
    localBus.notify();
  },

  async edit(conversationId, messageId, editor, text) {
    if (!editor) throw new Error("Please log in to edit messages.");
    if (!canUseMarketplace(editor)) throw new Error(verificationNotice(editor));
    const body = text.trim();
    if (!body) throw new Error("Please write a message first.");
    if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
    const messages = readMessages();
    const message = messages.find((entry) => entry.id === messageId && entry.conversationId === conversationId);
    if (!message) throw new Error("That message is no longer available.");
    if (message.senderId !== editor.id) throw new Error("You can only edit your own messages.");
    const conversations = readConversations();
    const conversation = conversations.find((entry) => entry.id === conversationId);
    if (!conversation || !isParticipant(conversation, editor.id)) throw new Error("This conversation is not available.");
    const newest = newestMessage(messages, conversationId);
    writeList(MESSAGES_KEY, messages.map((entry) => (entry.id === messageId ? { ...entry, text: body, editedAt: new Date().toISOString() } : entry)));
    if (newest?.id === messageId) {
      writeList(CONVERSATIONS_KEY, conversations.map((entry) => (entry.id === conversationId ? { ...entry, lastMessage: body } : entry)));
    }
    localBus.notify();
  },

  async remove(conversationId, messageId, user) {
    if (!user) throw new Error("Please log in to delete messages.");
    const messages = readMessages();
    const message = messages.find((entry) => entry.id === messageId && entry.conversationId === conversationId);
    if (!message) return; // already deleted
    if (message.senderId !== user.id) throw new Error("You can only delete your own messages.");
    const conversations = readConversations();
    const conversation = conversations.find((entry) => entry.id === conversationId);
    if (!conversation || !isParticipant(conversation, user.id)) throw new Error("This conversation is not available.");
    const wasLatest = newestMessage(messages, conversationId)?.id === messageId;
    const remaining = messages.filter((entry) => entry.id !== messageId);
    writeList(MESSAGES_KEY, remaining);
    writeList(UNREAD_KEY, readUnread().filter((entry) => entry.messageId !== messageId));
    if (wasLatest) {
      const next = newestMessage(remaining, conversationId);
      writeList(CONVERSATIONS_KEY, conversations.map((entry) => (entry.id === conversationId
        ? { ...entry, lastMessage: next ? next.text : "", updatedAt: next ? next.createdAt : entry.createdAt }
        : entry)));
    }
    localBus.notify();
  },

  /** Keeps stored names in step when a user edits their full name. */
  async syncUserName(user) {
    const name = formatSellerName(user.fullName);
    const conversations = readConversations();
    const stale = (c: Conversation) =>
      (c.buyerId === user.id && c.buyerName !== name) || (c.sellerId === user.id && c.sellerName !== name);
    if (!conversations.some(stale)) return;
    writeList(
      CONVERSATIONS_KEY,
      conversations.map((c) => ({
        ...c,
        buyerName: c.buyerId === user.id ? name : c.buyerName,
        sellerName: c.sellerId === user.id ? name : c.sellerName,
      })),
    );
    localBus.notify();
  },

  subscribeUnread: (userId, onData, onError) =>
    localSubscribe(
      () => readUnread()
        .filter((entry) => entry.recipientId === userId)
        .map((entry) => ({ messageId: entry.messageId, conversationId: entry.conversationId })),
      onData,
      onError,
    ),

  async markRead(userId, messageIds) {
    const ids = new Set(messageIds);
    const all = readUnread();
    const remaining = all.filter((entry) => !(entry.recipientId === userId && ids.has(entry.messageId)));
    if (remaining.length === all.length) return;
    writeList(UNREAD_KEY, remaining);
    localBus.notify();
  },
};

// ---- public API ----------------------------------------------------------------------------------------------

const firestoreBackend: MessageBackend = {
  subscribeConversations: firestoreMessages.subscribeConversations,
  // Firestore reads are decided by the security rules, so the user id is not needed here.
  subscribeConversation: (conversationId, _userId, onData, onError) => firestoreMessages.subscribeConversation(conversationId, onData, onError),
  subscribeMessages: (conversationId, _userId, onData, onError) => firestoreMessages.subscribeMessages(conversationId, onData, onError),
  getOrCreateConversation: firestoreMessages.getOrCreateConversation,
  send: firestoreMessages.send,
  edit: firestoreMessages.edit,
  remove: firestoreMessages.remove,
  syncUserName: firestoreMessages.syncUserName,
  subscribeUnread: firestoreMessages.subscribeUnread,
  markRead: firestoreMessages.markRead,
};

const backend: MessageBackend = isFirebaseConfigured ? firestoreBackend : localBackend;

export const messageService = {
  /** Live list of the signed-in user's conversations. */
  subscribeConversations: backend.subscribeConversations,
  /** Live single conversation; calls back with null if it doesn't exist or isn't yours. */
  subscribeConversation: backend.subscribeConversation,
  /** Live messages of one conversation, oldest first. */
  subscribeMessages: backend.subscribeMessages,
  /** One conversation per buyer + seller + listing. */
  getOrCreateConversation: backend.getOrCreateConversation,
  /** Sends a message. It appears through the subscription (immediately, even before the server confirms). */
  send: backend.send,
  /** Edits your own message (the preview follows if it is the latest). */
  edit: backend.edit,
  /** Deletes your own message (the preview moves to the newest remaining one if it was the latest). */
  remove: backend.remove,
  syncUserName: backend.syncUserName,
  /** Live unread markers of the signed-in user across all conversations (one listener; at most one marker per message). */
  subscribeUnread: backend.subscribeUnread,
  /** Marks messages as read (their markers disappear everywhere, on every device). Repeating it is harmless. */
  markRead: backend.markRead,
};

/** The other person in a conversation, from the viewer's point of view. */
export function otherPartyId(conversation: Conversation, userId: string): string {
  return conversation.buyerId === userId ? conversation.sellerId : conversation.buyerId;
}

/** Unread messages grouped for the UI. `total` counts each message once. */
export type UnreadSummary = { total: number; idsByConversation: Map<string, string[]> };

export function summarizeUnread(entries: UnreadEntry[]): UnreadSummary {
  const seen = new Set<string>();
  const idsByConversation = new Map<string, string[]>();
  for (const entry of entries) {
    if (seen.has(entry.messageId)) continue;
    seen.add(entry.messageId);
    const ids = idsByConversation.get(entry.conversationId);
    if (ids) ids.push(entry.messageId);
    else idsByConversation.set(entry.conversationId, [entry.messageId]);
  }
  return { total: seen.size, idsByConversation };
}

export const UNREAD_BADGE_MAX = 99;

/** Text for an unread badge: "" for none (no badge is shown), the number up to 99, then "99+". */
export function formatUnreadBadge(count: number): string {
  if (!Number.isFinite(count) || count < 1) return "";
  return count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(Math.floor(count));
}

/** Other person's display name from the viewer's point of view. */
export function otherPartyName(conversation: Conversation, userId: string): string {
  return conversation.buyerId === userId ? conversation.sellerName : conversation.buyerName;
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

const timeFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** "10:42 AM" today, "Yesterday", otherwise a short date. */
export function formatConversationTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString("en-PH", timeFormat);
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", timeFormat);
}

/** "TODAY", "YESTERDAY" or e.g. "MAR 4" for the day dividers in a chat. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" }).toUpperCase();
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
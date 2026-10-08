import { formatSellerName } from "./listingService";
import type { Conversation, Listing, Message, User } from "./types";

// Local-only messaging (Phase 3). Conversations and messages live in
// localStorage; there is no networking, so nobody replies in real time.

const CONVERSATIONS_KEY = "campuscart.conversations";
const MESSAGES_KEY = "campuscart.messages";
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

const readConversations = () => readList(CONVERSATIONS_KEY, isConversation);
const readMessages = () => readList(MESSAGES_KEY, isMessage);

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const isParticipant = (conversation: Conversation, userId: string) =>
  conversation.buyerId === userId || conversation.sellerId === userId;

export const messageService = {
  /** The signed-in user's conversations, most recently active first. */
  getConversations(userId: string): Conversation[] {
    return readConversations()
      .filter((conversation) => isParticipant(conversation, userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  /** Returns undefined if it doesn't exist or the user isn't part of it. */
  getConversation(conversationId: string | null | undefined, userId: string): Conversation | undefined {
    if (!conversationId) return undefined;
    return readConversations().find(
      (conversation) => conversation.id === conversationId && isParticipant(conversation, userId),
    );
  },

  /** One conversation per buyer + seller + listing; reuses it if it exists. */
  getOrCreateConversation(listing: Listing, buyer: User | null): Conversation {
    if (!buyer) throw new Error("Please log in to message the seller.");
    if (buyer.id === listing.sellerId) throw new Error("This is your own listing.");
    const conversations = readConversations();
    const existing = conversations.find(
      (conversation) =>
        conversation.buyerId === buyer.id &&
        conversation.sellerId === listing.sellerId &&
        conversation.listingId === listing.id,
    );
    if (existing) return existing;
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
    return conversation;
  },

  /** Oldest first. Empty if the user isn't part of the conversation. */
  getMessages(conversationId: string, userId: string): Message[] {
    if (!this.getConversation(conversationId, userId)) return [];
    return readMessages()
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  send(conversationId: string, sender: User | null, text: string): Message {
    if (!sender) throw new Error("Please log in to send messages.");
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
    writeList(MESSAGES_KEY, [...readMessages(), message]);
    writeList(
      CONVERSATIONS_KEY,
      conversations.map((entry) =>
        entry.id === conversationId ? { ...entry, lastMessage: body, updatedAt: now } : entry,
      ),
    );
    return message;
  },

  /** Keeps stored names in step when a user edits their full name. */
  syncUserName(user: User): void {
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
  },
};

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
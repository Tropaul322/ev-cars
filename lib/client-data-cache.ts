import type { SavedCarCard } from "@/components/saved-car-grid";

export type CachedChatSession = {
  id: string;
  title: string | null;
  latestMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CachedChatMessage = {
  role: "user" | "assistant";
  content: string;
  payload: Record<string, unknown> | null;
  createdAt?: string;
};

export type CachedChat = CachedChatSession & {
  messages: CachedChatMessage[];
};

type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
};

const STALE_MS = 30_000;

let chatListEntry: CacheEntry<CachedChatSession[]> | null = null;
const chatDetailEntries = new Map<string, CacheEntry<CachedChat>>();
let savedCarsEntry: CacheEntry<SavedCarCard[]> | null = null;

function isFresh(entry: CacheEntry<unknown> | null | undefined) {
  return Boolean(entry && Date.now() - entry.fetchedAt < STALE_MS);
}

export function getCachedChatList() {
  return chatListEntry?.data ?? null;
}

export function setCachedChatList(chats: CachedChatSession[]) {
  chatListEntry = { data: chats, fetchedAt: Date.now() };
}

export function upsertCachedChatSession(session: CachedChatSession) {
  const current = chatListEntry?.data ?? [];
  const existingIndex = current.findIndex((item) => item.id === session.id);
  if (existingIndex >= 0) {
    const updated = [...current];
    // Preserve the original createdAt so sort order stays stable
    updated[existingIndex] = { ...session, createdAt: current[existingIndex].createdAt };
    setCachedChatList(updated);
  } else {
    setCachedChatList([session, ...current]);
  }
}

export function removeCachedChatSession(chatId: string) {
  if (!chatListEntry) return;
  setCachedChatList(chatListEntry.data.filter((item) => item.id !== chatId));
}

export function getCachedChat(chatId: string) {
  return chatDetailEntries.get(chatId)?.data ?? null;
}

export function setCachedChat(chat: CachedChat) {
  chatDetailEntries.set(chat.id, { data: chat, fetchedAt: Date.now() });
  upsertCachedChatSession(chat);
}

export function setCachedChatDetail(chat: CachedChat) {
  chatDetailEntries.set(chat.id, { data: chat, fetchedAt: Date.now() });
}

export function shouldRevalidateChatList() {
  return !isFresh(chatListEntry);
}

export function shouldRevalidateChat(chatId: string) {
  return !isFresh(chatDetailEntries.get(chatId));
}

export function getCachedSavedCars() {
  return savedCarsEntry?.data ?? null;
}

export function setCachedSavedCars(cars: SavedCarCard[]) {
  savedCarsEntry = { data: cars, fetchedAt: Date.now() };
}

export function invalidateSavedCarsCache() {
  savedCarsEntry = null;
}

export function shouldRevalidateSavedCars() {
  return !isFresh(savedCarsEntry);
}

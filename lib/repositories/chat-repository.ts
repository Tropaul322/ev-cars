import { getSupabaseRestConfig } from "./supabase-rest.ts";
import { vehicleExclusionKeys } from "../match-diagnostics.ts";
import type { MatchResponse, Vehicle } from "../types.ts";

export type ChatMessageRole = "user" | "assistant";

export type ChatMessagePayload = Record<string, unknown> | null;

export type ChatSession = {
  id: string;
  testerRegistrationId: string;
  title: string | null;
  latestMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  chatSessionId: string;
  testerRegistrationId: string;
  role: ChatMessageRole;
  content: string;
  payload: ChatMessagePayload;
  createdAt: string;
};

export type ChatWithMessages = ChatSession & {
  messages: ChatMessage[];
};

type ChatSessionRow = {
  id: string;
  tester_registration_id: string;
  title: string | null;
  latest_message_at: string;
  created_at: string;
  updated_at: string;
};

type ChatMessageRow = {
  id: string;
  chat_session_id: string;
  tester_registration_id: string;
  role: ChatMessageRole;
  content: string;
  payload: ChatMessagePayload;
  created_at: string;
};

const localChatSessions = new Map<string, ChatSessionRow>();
const localChatMessages = new Map<string, ChatMessageRow[]>();

export async function getChatSession(
  testerRegistrationId: string,
  chatSessionId: string
): Promise<ChatSession | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    const local = localChatSessions.get(chatSessionId);
    return local?.tester_registration_id === testerRegistrationId ? rowToSession(local) : null;
  }

  const params = new URLSearchParams({
    select: "id,tester_registration_id,title,latest_message_at,created_at,updated_at",
    id: `eq.${chatSessionId}`,
    tester_registration_id: `eq.${testerRegistrationId}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_sessions?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as ChatSessionRow[];
    return rowToSession(rows[0]);
  } catch {
    return null;
  }
}

export async function listChatSessions(testerRegistrationId: string, limit = 30): Promise<ChatSession[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return [...localChatSessions.values()]
      .filter((session) => session.tester_registration_id === testerRegistrationId)
      .sort((left, right) => right.latest_message_at.localeCompare(left.latest_message_at))
      .slice(0, limit)
      .map(rowToSession)
      .filter((session): session is ChatSession => Boolean(session));
  }

  const params = new URLSearchParams({
    select: "id,tester_registration_id,title,latest_message_at,created_at,updated_at",
    tester_registration_id: `eq.${testerRegistrationId}`,
    order: "latest_message_at.desc",
    limit: String(limit)
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_sessions?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as ChatSessionRow[];
    return rows.map(rowToSession).filter((session): session is ChatSession => Boolean(session));
  } catch {
    return [];
  }
}

export async function getLatestChat(testerRegistrationId: string): Promise<ChatWithMessages | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    const row = [...localChatSessions.values()]
      .filter((session) => session.tester_registration_id === testerRegistrationId)
      .sort((left, right) => right.latest_message_at.localeCompare(left.latest_message_at))[0];
    return row ? { ...rowToSession(row)!, messages: localMessagesFor(row.id) } : null;
  }

  const params = new URLSearchParams({
    select: "id,tester_registration_id,title,latest_message_at,created_at,updated_at",
    tester_registration_id: `eq.${testerRegistrationId}`,
    order: "latest_message_at.desc",
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_sessions?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 0 }
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as ChatSessionRow[];
    const session = rowToSession(rows[0]);
    if (!session) return null;
    return {
      ...session,
      messages: await listChatMessages(testerRegistrationId, session.id)
    };
  } catch {
    return null;
  }
}

export async function getChatWithMessages(
  testerRegistrationId: string,
  chatSessionId: string
): Promise<ChatWithMessages | null> {
  const session = await getChatSession(testerRegistrationId, chatSessionId);
  if (!session) return null;
  return {
    ...session,
    messages: await listChatMessages(testerRegistrationId, session.id)
  };
}

export async function ensureChatSession(
  testerRegistrationId: string,
  chatSessionId: string,
  titleSource?: string
): Promise<ChatSession> {
  const now = new Date().toISOString();
  const existing = await getChatSession(testerRegistrationId, chatSessionId);
  if (existing) return existing;

  const row: ChatSessionRow = {
    id: chatSessionId,
    tester_registration_id: testerRegistrationId,
    title: makeChatTitle(titleSource),
    latest_message_at: now,
    created_at: now,
    updated_at: now
  };

  localChatSessions.set(chatSessionId, row);

  const supabase = getSupabaseRestConfig();
  if (!supabase) return rowToSession(row)!;

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_sessions?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "resolution=ignore-duplicates,return=representation"
      },
      body: JSON.stringify(row)
    });
    if (!response.ok) return rowToSession(row)!;
    const rows = (await response.json()) as ChatSessionRow[];
    return rowToSession(rows[0]) ?? rowToSession(row)!;
  } catch {
    return rowToSession(row)!;
  }
}

export async function saveChatMessage(input: {
  chatSessionId: string;
  testerRegistrationId: string;
  role: ChatMessageRole;
  content: string;
  payload?: ChatMessagePayload;
}): Promise<ChatMessage> {
  const createdAt = new Date().toISOString();
  const row: ChatMessageRow = {
    id: crypto.randomUUID(),
    chat_session_id: input.chatSessionId,
    tester_registration_id: input.testerRegistrationId,
    role: input.role,
    content: normalizeContent(input.content),
    payload: input.payload ?? null,
    created_at: createdAt
  };

  const localRows = localChatMessages.get(input.chatSessionId) ?? [];
  localRows.push(row);
  localChatMessages.set(input.chatSessionId, localRows);
  touchLocalSession(input.chatSessionId, createdAt);

  const supabase = getSupabaseRestConfig();
  if (!supabase) return rowToMessage(row);

  try {
    const messageResponse = await fetch(`${supabase.url}/rest/v1/chat_messages`, {
      method: "POST",
      headers: {
        ...supabase.headers,
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });
    if (!messageResponse.ok) return rowToMessage(row);

    const sessionResponse = await fetch(`${supabase.url}/rest/v1/chat_sessions?id=eq.${input.chatSessionId}`, {
      method: "PATCH",
      headers: {
        ...supabase.headers,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ latest_message_at: createdAt })
    });
    if (!sessionResponse.ok) return rowToMessage(row);
  } catch {
    // Local history remains available for the current server process.
  }

  return rowToMessage(row);
}

export async function recoverShownVehicleKeysFromChat(
  testerRegistrationId: string,
  chatSessionId: string
): Promise<string[]> {
  const messages = await listChatMessages(testerRegistrationId, chatSessionId);
  const keys = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant" || !message.payload) continue;
    const matchResponse = message.payload.matchResponse;
    if (!matchResponse || typeof matchResponse !== "object") continue;

    const recommendations = (matchResponse as MatchResponse & { recommendations?: Array<{ vehicle?: Vehicle }> })
      .recommendations;
    if (!Array.isArray(recommendations)) continue;

    for (const recommendation of recommendations) {
      if (!recommendation?.vehicle) continue;
      for (const key of vehicleExclusionKeys(recommendation.vehicle)) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

export async function listChatMessages(testerRegistrationId: string, chatSessionId: string): Promise<ChatMessage[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return localMessagesFor(chatSessionId).filter((message) => message.testerRegistrationId === testerRegistrationId);

  const params = new URLSearchParams({
    select: "id,chat_session_id,tester_registration_id,role,content,payload,created_at",
    chat_session_id: `eq.${chatSessionId}`,
    tester_registration_id: `eq.${testerRegistrationId}`,
    order: "created_at.asc"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_messages?${params}`, {
      headers: supabase.headers,
      cache: "no-store"
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as ChatMessageRow[];
    return rows.map(rowToMessage);
  } catch {
    return [];
  }
}

function localMessagesFor(chatSessionId: string) {
  return (localChatMessages.get(chatSessionId) ?? []).map(rowToMessage);
}

function touchLocalSession(chatSessionId: string, latestMessageAt: string) {
  const session = localChatSessions.get(chatSessionId);
  if (!session) return;
  localChatSessions.set(chatSessionId, {
    ...session,
    latest_message_at: latestMessageAt,
    updated_at: latestMessageAt
  });
}

function rowToSession(row: ChatSessionRow | undefined): ChatSession | null {
  if (!row) return null;
  return {
    id: row.id,
    testerRegistrationId: row.tester_registration_id,
    title: row.title,
    latestMessageAt: row.latest_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    chatSessionId: row.chat_session_id,
    testerRegistrationId: row.tester_registration_id,
    role: row.role,
    content: row.content,
    payload: row.payload,
    createdAt: row.created_at
  };
}

function makeChatTitle(value: string | undefined) {
  const title = normalizeContent(value ?? "");
  return title ? title.slice(0, 120) : null;
}

function normalizeContent(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 8000);
}

import type { DemoRegistration } from "../demo-registration.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";
import {
  getChatWithMessages,
  listChatSessions,
  type ChatMessage,
  type ChatSession,
  type ChatWithMessages
} from "./chat-repository.ts";

export type AdminTesterRegistration = DemoRegistration & {
  createdAt: string;
  chatCount: number;
};

export type AdminChatSession = ChatSession & {
  messageCount: number;
};

type RegistrationRow = {
  id: string;
  name: string | null;
  email: string | null;
  location: string | null;
  consent_at: string | null;
  deletion_requested_at: string | null;
  created_at: string;
};

type ChatCountRow = {
  tester_registration_id: string;
};

const REGISTRATION_SELECT =
  "id,name,email,location,consent_at,deletion_requested_at,created_at";

export async function listAllTesterRegistrations(): Promise<AdminTesterRegistration[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return [];

  const params = new URLSearchParams({
    select: REGISTRATION_SELECT,
    order: "created_at.desc"
  });

  try {
    const [registrationResponse, chatCountResponse] = await Promise.all([
      fetch(`${supabase.url}/rest/v1/tester_registrations?${params}`, {
        headers: supabase.headers,
        cache: "no-store"
      }),
      fetch(
        `${supabase.url}/rest/v1/chat_sessions?select=tester_registration_id`,
        {
          headers: supabase.headers,
          cache: "no-store"
        }
      )
    ]);

    if (!registrationResponse.ok) return [];

    const rows = (await registrationResponse.json()) as RegistrationRow[];
    const chatCounts = new Map<string, number>();

    if (chatCountResponse.ok) {
      const chatRows = (await chatCountResponse.json()) as ChatCountRow[];
      for (const row of chatRows) {
        chatCounts.set(row.tester_registration_id, (chatCounts.get(row.tester_registration_id) ?? 0) + 1);
      }
    }

    return rows
      .map((row) => rowToAdminRegistration(row, chatCounts.get(row.id) ?? 0))
      .filter((registration): registration is AdminTesterRegistration => Boolean(registration));
  } catch {
    return [];
  }
}

export async function getTesterRegistrationAdmin(id: string): Promise<AdminTesterRegistration | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

  const params = new URLSearchParams({
    select: REGISTRATION_SELECT,
    id: `eq.${id}`,
    limit: "1"
  });

  try {
    const [registrationResponse, chatSessions] = await Promise.all([
      fetch(`${supabase.url}/rest/v1/tester_registrations?${params}`, {
        headers: supabase.headers,
        cache: "no-store"
      }),
      listChatSessionsForUserAdmin(id)
    ]);

    if (!registrationResponse.ok) return null;
    const rows = (await registrationResponse.json()) as RegistrationRow[];
    return rowToAdminRegistration(rows[0], chatSessions.length);
  } catch {
    return null;
  }
}

export async function listChatSessionsForUserAdmin(
  testerRegistrationId: string,
  limit = 100
): Promise<AdminChatSession[]> {
  const sessions = await listChatSessions(testerRegistrationId, limit);
  const enriched = await Promise.all(
    sessions.map(async (session) => ({
      ...session,
      messageCount: await countChatMessagesAdmin(session.id)
    }))
  );
  return enriched;
}

export async function getChatWithMessagesAdmin(chatSessionId: string): Promise<ChatWithMessages | null> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return null;

  const params = new URLSearchParams({
    select: "id,tester_registration_id,title,latest_message_at,created_at,updated_at",
    id: `eq.${chatSessionId}`,
    limit: "1"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_sessions?${params}`, {
      headers: supabase.headers,
      cache: "no-store"
    });
    if (!response.ok) return null;

    const rows = (await response.json()) as Array<{
      id: string;
      tester_registration_id: string;
      title: string | null;
      latest_message_at: string;
      created_at: string;
      updated_at: string;
    }>;
    const row = rows[0];
    if (!row) return null;

    const messages = await listChatMessagesAdmin(chatSessionId);
    return {
      id: row.id,
      testerRegistrationId: row.tester_registration_id,
      title: row.title,
      latestMessageAt: row.latest_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages
    };
  } catch {
    return null;
  }
}

export async function getChatWithMessagesForUserAdmin(
  testerRegistrationId: string,
  chatSessionId: string
): Promise<ChatWithMessages | null> {
  return getChatWithMessages(testerRegistrationId, chatSessionId);
}

async function listChatMessagesAdmin(chatSessionId: string): Promise<ChatMessage[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return [];

  const params = new URLSearchParams({
    select: "id,chat_session_id,tester_registration_id,role,content,payload,created_at",
    chat_session_id: `eq.${chatSessionId}`,
    order: "created_at.asc"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/chat_messages?${params}`, {
      headers: supabase.headers,
      cache: "no-store"
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as Array<{
      id: string;
      chat_session_id: string;
      tester_registration_id: string;
      role: ChatMessage["role"];
      content: string;
      payload: ChatMessage["payload"];
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      chatSessionId: row.chat_session_id,
      testerRegistrationId: row.tester_registration_id,
      role: row.role,
      content: row.content,
      payload: row.payload,
      createdAt: row.created_at
    }));
  } catch {
    return [];
  }
}

async function countChatMessagesAdmin(chatSessionId: string) {
  const messages = await listChatMessagesAdmin(chatSessionId);
  return messages.length;
}

function rowToAdminRegistration(
  row: RegistrationRow | undefined,
  chatCount: number
): AdminTesterRegistration | null {
  if (!row?.id || !row.consent_at || !row.name || !row.email || !row.location) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    location: row.location,
    consentAt: row.consent_at,
    deletionRequestedAt: row.deletion_requested_at,
    createdAt: row.created_at,
    chatCount
  };
}

export async function deleteTesterRegistrationAdmin(id: string): Promise<{ deleted: boolean; error?: string }> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return { deleted: false, error: "Supabase is not configured." };
  }

  try {
    const response = await fetch(`${supabase.url}/rest/v1/tester_registrations?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        ...supabase.headers,
        Prefer: "return=minimal"
      }
    });

    if (!response.ok) {
      return { deleted: false, error: await response.text() };
    }

    return { deleted: true };
  } catch (error) {
    return {
      deleted: false,
      error: error instanceof Error ? error.message : "Failed to delete user."
    };
  }
}

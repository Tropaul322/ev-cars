"use client";

import Link from "next/link";
import type { AdminChatSession } from "@/lib/repositories/admin-repository";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function UserChatsList({
  userId,
  chats
}: {
  userId: string;
  chats: AdminChatSession[];
}) {
  if (!chats.length) {
    return (
      <div className="rounded-3xl bg-muted px-6 py-10 text-center text-muted-foreground">
        No chats for this user yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {chats.map((chat) => (
        <Link
          key={chat.id}
          href={`/admin/users/${userId}/chats/${chat.id}`}
          className="rounded-3xl border border-border bg-card px-5 py-4 transition-colors hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="font-medium">{chat.title ?? "Untitled chat"}</p>
              <p className="text-sm text-muted-foreground">
                {chat.messageCount} messages · last activity {formatDate(chat.latestMessageAt)}
              </p>
            </div>
            <span className="text-sm text-muted-foreground">View</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

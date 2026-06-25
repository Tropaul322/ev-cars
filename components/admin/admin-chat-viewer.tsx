"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/repositories/chat-repository";
import { cn } from "@/lib/utils";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function AdminChatViewer({
  title,
  messages
}: {
  title: string | null;
  messages: ChatMessage[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-2xl font-extrabold">{title ?? "Untitled chat"}</h2>
        <p className="text-sm text-muted-foreground">{messages.length} messages</p>
      </div>
      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = Boolean(message.payload && Object.keys(message.payload).length > 0);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-3xl px-4 py-3",
        message.role === "user" ? "bg-bubble-user text-bubble-user-foreground" : "bg-bubble-bot"
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide">{message.role}</span>
        <span>{formatDate(message.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{message.content}</p>
      {hasPayload ? (
        <button
          type="button"
          className="self-start text-xs font-medium underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide payload" : "Show payload"}
        </button>
      ) : null}
      {expanded && message.payload ? (
        <pre className="overflow-x-auto rounded-2xl bg-background/70 p-3 text-xs">
          {JSON.stringify(message.payload, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

"use client";

import {
  ChevronDown,
  Clock3,
  History,
  ListPlus,
  Lock,
  MessageCirclePlus,
  Sparkles,
} from "lucide-react";
import { VehicleImage } from "@/components/vehicle-image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type ReactNode,
} from "react";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { WebShell } from "@/components/WebShell";
import { SaveCarButton } from "@/components/save-car-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  getDemoRegistrationStatus,
  hasDemoAccess,
  openDemoRegistration,
  peekDemoRegistrationStatus,
  requireDemoAccess,
} from "@/lib/demo-access-client";
import {
  buildMockMatchPreview,
  mockPreviewAssistantMessage,
  mockPreviewDelayMs,
} from "@/lib/mock-match-preview";
import type { SavedCarSnapshot } from "@/lib/repositories/saved-car-repository";
import { cn, formatEUR, formatNumber } from "@/lib/utils";
import {
  getCachedChat,
  getCachedChatList,
  setCachedChat,
  setCachedChatDetail,
  setCachedChatList,
  shouldRevalidateChat,
  shouldRevalidateChatList,
  upsertCachedChatSession,
  type CachedChat,
  type CachedChatSession,
} from "@/lib/client-data-cache";
import type {
  ClarificationOption,
  ClarificationPrompt,
  CriteriaPatch,
  MatchResponse,
  MatchResult,
  MissingCriteria,
  SearchCriteriaDebug,
  UserCriteria,
} from "@/lib/types";
import {
  formatCondition,
  getVehicleDetailSections,
  getVehicleDetailStats,
} from "@/lib/vehicle-detail-fields";

type Message =
  | { role: "user"; text: string }
  | { role: "bot"; text: ReactNode; preview?: boolean; prompt?: ClarificationPrompt }
  | {
      role: "results";
      matches: MatchResult[];
      alternativeMatches?: MatchResult[];
      alternativesRevealed?: boolean;
      preview?: boolean;
    };

type SendPayload = {
  criteriaPatch?: CriteriaPatch;
  intent?: "show_matches" | "show_alternatives";
  skippedKeys?: MissingCriteria[];
  currentPromptKey?: ClarificationPrompt["key"];
};

type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
  payload: Record<string, unknown> | null;
  createdAt?: string;
};

type StoredChatSession = CachedChatSession;
type StoredChat = CachedChat;

const initialMessages: Message[] = [
  {
    role: "bot",
    text: (
      <>
        <p>
          Hey! I&apos;m FlowRyd, your electric car assistant. Tell me what kind
          of electric car you need.
        </p>
        <p className="mt-2">
          I&apos;ll ask for missing details before ranking real matches.
        </p>
      </>
    ),
  },
];

const PENDING_CHAT_ID = "__pending__";

function createPendingSession(): StoredChatSession {
  const now = new Date().toISOString();
  return {
    id: PENDING_CHAT_ID,
    title: "New search",
    latestMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export default function ChatPage() {
  const router = useRouter();
  const params = useParams<{ chatId?: string | string[] }>();
  const routeChatId = Array.isArray(params.chatId)
    ? params.chatId[0]
    : typeof params.chatId === "string"
      ? params.chatId
      : undefined;
  const composerRef = useRef<ComposerHandle>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<UserCriteria | null>(null);
  const [searchCriteriaDebug, setSearchCriteriaDebug] = useState<SearchCriteriaDebug | null>(null);
  const [activePrompt, setActivePrompt] = useState<ClarificationPrompt | null>(null);
  const [skippedKeys, setSkippedKeys] = useState<MissingCriteria[]>([]);
  const [chatSessions, setChatSessions] = useState<StoredChatSession[]>(
    () => getCachedChatList() ?? [],
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(
    () => !getCachedChatList(),
  );
  const [demoAccess, setDemoAccess] = useState<boolean | null>(
    () => peekDemoRegistrationStatus()?.registered ?? null,
  );
  const [restoringChatId, setRestoringChatId] = useState<string | null>(null);
  const entranceAnimationStartIndex = useRef(0);
  const pendingRealQuery = useRef<string | null>(null);
  const previewTimer = useRef<number | null>(null);
  const sendRealRef = useRef<
    (text: string, options?: { replacePreview?: boolean }) => Promise<void>
  >(async () => {});
  const sendMockPreviewRef = useRef<(text: string) => void>(() => {});

  const loadChatSessions = useCallback(async (options?: { force?: boolean }) => {
    const cached = getCachedChatList();
    if (!options?.force && cached && !shouldRevalidateChatList()) {
      setHistoryLoading(false);
      return cached;
    }

    setHistoryLoading(!cached);
    try {
      const response = await fetch("/api/chats");
      if (!response.ok) {
        if (cached) setChatSessions(cached);
        return cached ?? [];
      }
      const data = (await response.json()) as { chats: StoredChatSession[] };
      setCachedChatList(data.chats);
      setChatSessions(data.chats);
      return data.chats;
    } catch {
      if (cached) setChatSessions(cached);
      return cached ?? [];
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const applyStoredChat = useCallback((chat: StoredChat) => {
    const hydrated = hydrateStoredChat(chat);
    entranceAnimationStartIndex.current = hydrated.messages.length;
    setSessionId(chat.id);
    setMessages(hydrated.messages);
    setCriteria(hydrated.criteria);
    setSearchCriteriaDebug(extractLatestSearchCriteriaDebug(chat));
    setActivePrompt(hydrated.activePrompt);
    setSkippedKeys([]);
    setCachedChatDetail(chat);
  }, []);

  const selectChat = useCallback(
    (chatId: string) => {
      if (loading || chatId === routeChatId) return;
      if (chatId === PENDING_CHAT_ID) return;
      setHistoryOpen(false);
      router.push(`/chat/${chatId}`);
    },
    [loading, routeChatId, router],
  );

  const startNewChat = useCallback(() => {
    if (loading) return;
    const pending = createPendingSession();
    setHistoryOpen(false);
    setChatSessions((current) => {
      const withoutPending = current.filter((item) => item.id !== PENDING_CHAT_ID);
      const next = [pending, ...withoutPending];
      setCachedChatList(next);
      return next;
    });
    if (routeChatId) {
      router.push("/chat");
    } else {
      setSessionId(null);
      setCriteria(null);
      setSearchCriteriaDebug(null);
      setActivePrompt(null);
      setSkippedKeys([]);
      entranceAnimationStartIndex.current = initialMessages.length;
      setMessages(initialMessages);
      setRestoringChatId(null);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [loading, routeChatId, router]);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
  }, []);

  const stripPreviewMessages = useCallback((current: Message[]) => {
    return current.filter(
      (message) =>
        message.role === "user" || !("preview" in message && message.preview),
    );
  }, []);

  const sendReal = useCallback(
    async (
      text: string,
      options?: { replacePreview?: boolean; payload?: SendPayload },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      clearPreviewTimer();
      const payload = options?.payload;

      if (options?.replacePreview) {
        setMessages((current) => {
          const withoutPreview = stripPreviewMessages(current);
          const hasUserMessage = withoutPreview.some(
            (message) => message.role === "user" && message.text === trimmed,
          );
          return hasUserMessage
            ? withoutPreview
            : [...withoutPreview, { role: "user" as const, text: trimmed }];
        });
      } else {
        setMessages((current) => [...current, { role: "user", text: trimmed }]);
      }

      setLoading(true);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch("/api/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            message: trimmed,
            sessionId,
            previousCriteria: criteria,
            criteriaPatch: payload?.criteriaPatch,
            intent: payload?.intent,
            skippedKeys: payload?.skippedKeys ?? skippedKeys,
            currentPromptKey: payload?.currentPromptKey ?? activePrompt?.key,
          }),
        });

        if (response.status === 401) {
          openDemoRegistration();
          throw new Error("Demo registration is required.");
        }
        if (!response.ok)
          throw new Error("The matching service returned an error.");

        const data = (await response.json()) as MatchResponse;
        if ("matchDiagnostics" in data && data.matchDiagnostics) {
          console.info("[match diagnostics]", data.matchDiagnostics);
        }
        if ("searchCriteriaDebug" in data && data.searchCriteriaDebug) {
          setSearchCriteriaDebug(data.searchCriteriaDebug);
          console.info("[search criteria]", data.searchCriteriaDebug);
        } else {
          setSearchCriteriaDebug(null);
        }
        const nextPrompt =
          (data.type === "chat" || data.type === "clarification") && data.prompt
            ? data.prompt
            : null;
        const now = new Date().toISOString();
        const urlChanging = routeChatId !== data.sessionId;
        const existingCached =
          getCachedChat(data.sessionId) ??
          (sessionId ? getCachedChat(sessionId) : null);
        const existingIndex = chatSessions.findIndex(
          (item) => item.id === data.sessionId,
        );
        const sessionMeta: StoredChatSession = {
          id: data.sessionId,
          title: trimmed.slice(0, 80) || "Untitled EV search",
          latestMessageAt: now,
          createdAt:
            existingIndex >= 0
              ? chatSessions[existingIndex].createdAt
              : existingCached?.createdAt ?? now,
          updatedAt: now,
        };

        setSessionId(data.sessionId);
        setCriteria(data.criteria);
        setActivePrompt(nextPrompt);
        setCachedChat({
          ...sessionMeta,
          messages: [
            ...(existingCached?.messages ?? []),
            { role: "user", content: trimmed, payload: null, createdAt: now },
            {
              role: "assistant",
              content: data.assistantMessage,
              payload: { matchResponse: data },
              createdAt: now,
            },
          ],
        });
        if (urlChanging) {
          router.replace(`/chat/${data.sessionId}`);
        }
        setChatSessions((current) => {
          const withoutPending = current.filter(
            (item) => item.id !== PENDING_CHAT_ID,
          );
          const listIndex = withoutPending.findIndex(
            (item) => item.id === data.sessionId,
          );
          let next: StoredChatSession[];
          if (listIndex >= 0) {
            next = [...withoutPending];
            next[listIndex] = sessionMeta;
          } else {
            next = [sessionMeta, ...withoutPending];
          }
          setCachedChatList(next);
          upsertCachedChatSession(sessionMeta);
          return next;
        });
        setMessages((current) => [
          ...stripPreviewMessages(current),
          {
            role: "bot",
            text: <p>{data.assistantMessage}</p>,
            ...(nextPrompt ? { prompt: nextPrompt } : {}),
          },
          ...(data.type === "matches" && data.recommendations.length
            ? [
                {
                  role: "results" as const,
                  matches: data.recommendations,
                  alternativeMatches: data.alternativeRecommendations ?? [],
                  alternativesRevealed: data.responseMode === "alternatives",
                },
              ]
            : []),
        ]);
        void loadChatSessions();
        void fetch(`/api/chats/${encodeURIComponent(data.sessionId)}`)
          .then((response) => (response.ok ? response.json() : null))
          .then((payload: { chat?: StoredChat } | null) => {
            if (payload?.chat) setCachedChat(payload.chat);
          })
          .catch(() => undefined);
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "AbortError";
        setMessages((current) => [
          ...stripPreviewMessages(current),
          {
            role: "bot",
            text: (
              <p>
                {timedOut
                  ? "Search took too long — try again."
                  : error instanceof Error
                    ? error.message
                    : "Something went wrong."}
              </p>
            ),
          },
        ]);
      } finally {
        window.clearTimeout(timeoutId);
        setLoading(false);
      }
    },
    [
      activePrompt,
      chatSessions,
      criteria,
      clearPreviewTimer,
      loadChatSessions,
      loading,
      routeChatId,
      router,
      sessionId,
      skippedKeys,
      stripPreviewMessages,
    ],
  );

  const sendMockPreview = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      pendingRealQuery.current = trimmed;
      setMessages((current) => [...current, { role: "user", text: trimmed }]);
      setLoading(true);
      router.replace("/chat");

      if (previewTimer.current !== null) {
        window.clearTimeout(previewTimer.current);
      }

      previewTimer.current = window.setTimeout(() => {
        previewTimer.current = null;
        setLoading(false);
        setMessages((current) => [
          ...current,
          {
            role: "bot",
            preview: true,
            text: <p>{mockPreviewAssistantMessage}</p>,
          },
          {
            role: "results",
            preview: true,
            matches: buildMockMatchPreview(),
          },
        ]);
        openDemoRegistration();
      }, mockPreviewDelayMs);
    },
    [loading, router],
  );

  sendRealRef.current = sendReal;
  sendMockPreviewRef.current = sendMockPreview;

  const send = useCallback(
    async (text: string, payload?: SendPayload) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      if (await hasDemoAccess()) {
        await sendReal(trimmed, { payload });
        return;
      }

      const allowed = await requireDemoAccess();
      if (allowed) await sendReal(trimmed, { payload });
    },
    [loading, sendReal],
  );

  const handlePromptSelect = useCallback(
    (prompt: ClarificationPrompt, options: ClarificationOption[]) => {
      if (loading || !options.length) return;
      const label = options.map((option) => option.label).join(", ");
      const skipOption = options.find((option) => option.skip);

      if (skipOption && isMissingKey(prompt.key)) {
        const nextSkipped = Array.from(new Set([...skippedKeys, prompt.key]));
        setSkippedKeys(nextSkipped);
        void send(label, {
          skippedKeys: nextSkipped,
          currentPromptKey: prompt.key,
        });
        return;
      }

      const criteriaPatch = mergeOptionPatches(options);
      void send(label, { criteriaPatch, currentPromptKey: prompt.key });
    },
    [loading, send, skippedKeys],
  );

  const revealAlternatives = useCallback((messageIndex: number) => {
    setMessages((current) =>
      current.map((message, index) => {
        if (index !== messageIndex || message.role !== "results") return message;
        if (!message.alternativeMatches?.length || message.alternativesRevealed) {
          return message;
        }
        return {
          ...message,
          matches: [...message.matches, ...message.alternativeMatches],
          alternativeMatches: [],
          alternativesRevealed: true,
        };
      }),
    );
  }, []);

  useEffect(() => {
    return () => {
      clearPreviewTimer();
    };
  }, [clearPreviewTimer]);

  useEffect(() => {
    let cancelled = false;

    const refreshAccess = async () => {
      const status = await getDemoRegistrationStatus();
      if (!cancelled) setDemoAccess(status.registered);
    };

    void refreshAccess();
    window.addEventListener("flowryd:registration-changed", refreshAccess);
    return () => {
      cancelled = true;
      window.removeEventListener("flowryd:registration-changed", refreshAccess);
    };
  }, []);

  useEffect(() => {
    const onRegistrationChanged = () => {
      void (async () => {
        if (!(await hasDemoAccess())) return;
        const query = pendingRealQuery.current;
        if (!query) return;
        pendingRealQuery.current = null;
        clearPreviewTimer();
        await sendReal(query, { replacePreview: true });
      })();
    };

    window.addEventListener(
      "flowryd:registration-changed",
      onRegistrationChanged,
    );
    return () =>
      window.removeEventListener(
        "flowryd:registration-changed",
        onRegistrationChanged,
      );
  }, [clearPreviewTimer, sendReal]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (loading || historyOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      composerRef.current?.appendText(event.key);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyOpen, loading]);

  useEffect(() => {
    void loadChatSessions();
  }, [loadChatSessions]);

  useEffect(() => {
    if (routeChatId) return;

    const query = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!query) {
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }

    let cancelled = false;

    void (async () => {
      if (await hasDemoAccess()) {
        if (!cancelled) await sendRealRef.current(query);
      } else if (!cancelled) {
        sendMockPreviewRef.current(query);
      }
    })();

    return () => {
      cancelled = true;
      clearPreviewTimer();
      setLoading(false);
    };
  }, [clearPreviewTimer, routeChatId]);

  useEffect(() => {
    if (!routeChatId) {
      const query = new URLSearchParams(window.location.search).get("q")?.trim();
      if (!query && !sessionId) {
        setSessionId(null);
        setCriteria(null);
        setActivePrompt(null);
        setSkippedKeys([]);
        entranceAnimationStartIndex.current = initialMessages.length;
        setMessages(initialMessages);
        setRestoringChatId(null);
      }
      return;
    }

    if (routeChatId === sessionId) {
      setRestoringChatId(null);
      return;
    }

    const cached = getCachedChat(routeChatId);
    if (cached) {
      applyStoredChat(cached);
      setRestoringChatId(null);
    } else {
      setSessionId(null);
      setCriteria(null);
      setSearchCriteriaDebug(null);
      setActivePrompt(null);
      setSkippedKeys([]);
      entranceAnimationStartIndex.current = 0;
      setMessages([]);
      setRestoringChatId(routeChatId);
    }

    if (cached && !shouldRevalidateChat(routeChatId)) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/chats/${encodeURIComponent(routeChatId)}`,
        );
        if (response.status === 401) {
          openDemoRegistration();
          return;
        }
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { chat: StoredChat };
        if (!cancelled) {
          applyStoredChat(data.chat);
          setRestoringChatId(null);
        }
      } catch {
        // Keep cached content when refresh fails.
      } finally {
        if (!cancelled) setRestoringChatId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyStoredChat, routeChatId, sessionId]);

  const lastPromptIndex = findLastPromptIndex(messages);
  const hasUserMessages = messages.some((message) => message.role === "user");
  const emptyPreviewMatches = useMemo(() => buildMockMatchPreview(), []);

  const activeSessionId = useMemo(() => {
    if (routeChatId) return routeChatId;
    if (sessionId) return sessionId;
    if (chatSessions.some((item) => item.id === PENDING_CHAT_ID)) {
      return PENDING_CHAT_ID;
    }
    return null;
  }, [chatSessions, routeChatId, sessionId]);

  const showLockedEmptyPreview =
    demoAccess === false &&
    !routeChatId &&
    !sessionId &&
    !loading &&
    !restoringChatId &&
    !hasUserMessages;

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;

    const scrollToBottom = () => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    };

    const frame = requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(scrollToBottom);
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, loading]);

  return (
    <WebShell hideFooter fullHeight>
      <div className="mx-auto flex w-full max-w-7xl flex-1 min-h-0 gap-6 px-4 pt-6 sm:px-6 lg:px-10">
        <aside className="hidden lg:flex w-80 shrink-0 min-h-0 flex-col self-stretch border-r border-border pr-5">
          <ChatHistoryPanel
            sessions={chatSessions}
            activeSessionId={activeSessionId}
            loading={historyLoading}
            onNewChat={startNewChat}
            onSelectChat={selectChat}
          />
        </aside>

        <div className="mx-auto flex w-full max-w-3xl flex-1 min-h-0 flex-col">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="size-10 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
                <Sparkles className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display font-extrabold text-2xl">
                  Find my car
                </h1>
                <p className="text-sm text-muted-foreground">
                  Chat with FlowRyd to narrow your match.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" aria-hidden="true" />
              History
            </Button>
          </div>

          <div
            ref={messagesScrollRef}
            className="scrollbar-none flex-1 min-h-0 overflow-y-auto pb-4"
          >
            <div className="flex flex-col gap-4">
              {restoringChatId && messages.length === 0 ? (
                <ChatRestoreLoader />
              ) : null}
              {messages.map((message, index) => {
                const shouldAnimateEntrance =
                  index >= entranceAnimationStartIndex.current;

                if (message.role === "user") {
                  return (
                    <div
                      key={index}
                      className={cn(
                        "flex justify-end",
                        shouldAnimateEntrance &&
                          "animate-in fade-in slide-in-from-bottom-2 duration-300",
                      )}
                    >
                      <div className="max-w-[80%] rounded-3xl bg-bubble-user text-bubble-user-foreground px-5 py-3 text-[15px]">
                        {message.text}
                      </div>
                    </div>
                  );
                }
                if (message.role === "bot") {
                  return (
                    <div
                      key={index}
                      className={cn(
                        "flex flex-col gap-3",
                        shouldAnimateEntrance &&
                          "animate-in fade-in slide-in-from-bottom-2 duration-500",
                      )}
                    >
                      <div className="max-w-[85%] rounded-3xl bg-bubble-bot px-5 py-4 text-[15px] leading-relaxed">
                        {message.text}
                      </div>
                      {message.prompt ? (
                        <ChatPrompt
                          prompt={message.prompt}
                          disabled={index !== lastPromptIndex || loading}
                          animate={shouldAnimateEntrance}
                          onSelect={handlePromptSelect}
                        />
                      ) : null}
                    </div>
                  );
                }
                return (
                  <ResultsBlock
                    key={index}
                    matches={message.matches}
                    alternativeMatches={message.alternativeMatches ?? []}
                    alternativesRevealed={Boolean(message.alternativesRevealed)}
                    locked={Boolean(message.preview)}
                    animate={shouldAnimateEntrance}
                    onRevealAlternatives={() => revealAlternatives(index)}
                  />
                );
              })}
              {showLockedEmptyPreview ? (
                <EmptyChatPreview matches={emptyPreviewMatches} />
              ) : null}
              {loading ? <LoadingBlock /> : null}
            </div>
          </div>

          <div className="py-4 bg-background">
            {searchCriteriaDebug ? (
              <SearchCriteriaDebugPanel debug={searchCriteriaDebug} />
            ) : null}
            <Composer
              ref={composerRef}
              placeholder="Ask a follow-up question..."
              disabled={loading}
              variant="flat"
              autoFocus={!routeChatId}
              onSubmit={(value) => void send(value)}
            />
          </div>
        </div>

        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent
            side="left"
            className="w-[calc(100vw-32px)] max-w-sm p-0"
          >
            <SheetTitle className="sr-only">Chat history</SheetTitle>
            <div className="h-full p-5">
              <ChatHistoryPanel
                sessions={chatSessions}
                activeSessionId={activeSessionId}
                loading={historyLoading}
                onNewChat={startNewChat}
                onSelectChat={selectChat}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </WebShell>
  );
}

const ChatHistoryPanel = memo(function ChatHistoryPanel({
  sessions,
  activeSessionId,
  loading,
  onNewChat,
  onSelectChat,
}: {
  sessions: StoredChatSession[];
  activeSessionId: string | null;
  loading: boolean;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef(0);

  const handleScroll = useCallback(() => {
    if (listRef.current) {
      savedScrollTop.current = listRef.current.scrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = savedScrollTop.current;
  });

  const showSkeleton = loading && sessions.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold">Chat history</h2>
          <p className="text-xs text-muted-foreground">
            Pick up an earlier search.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={onNewChat}
          aria-label="Start a new chat"
        >
          <MessageCirclePlus className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {showSkeleton ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-20 rounded-2xl bg-muted/60 animate-pulse"
              />
            ))}
          </div>
        ) : sessions.length ? (
          <div className="flex flex-col gap-2">
            {sessions.map((session) => {
              const isActive = activeSessionId === session.id;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectChat(session.id)}
                  className={cn(
                    "w-full min-h-20 rounded-2xl border px-3 py-3 text-left",
                    isActive
                      ? "border-primary/30 bg-accent text-accent-foreground shadow-sm"
                      : "border-transparent bg-muted/45 text-foreground hover:bg-muted",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-background/80 text-primary">
                      <History className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {session.title ?? "Untitled EV search"}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" aria-hidden="true" />
                        {formatChatTimestamp(session.latestMessageAt)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl bg-muted/50 px-4 py-5 text-sm text-muted-foreground">
            Your saved conversations will appear here after the first message.
          </div>
        )}
      </div>
    </div>
  );
});

function EmptyChatPreview({ matches }: { matches: MatchResult[] }) {
  return (
    <div className="pt-1">
      <ResultsBlock matches={matches} locked animate={false} />
    </div>
  );
}

function formatChatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function extractLatestSearchCriteriaDebug(chat: StoredChat): SearchCriteriaDebug | null {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const matchResponse = extractStoredMatchResponse(chat.messages[index]);
    if (matchResponse && "searchCriteriaDebug" in matchResponse && matchResponse.searchCriteriaDebug) {
      return matchResponse.searchCriteriaDebug;
    }
  }
  return null;
}

function SearchCriteriaDebugPanel({ debug }: { debug: SearchCriteriaDebug }) {
  return (
    <details className="mb-3 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-300">
        Search criteria debug
      </summary>
      <div className="mt-3 space-y-3">
        <div>
          <p className="mb-1 font-medium text-foreground">Found</p>
          {debug.found.length ? (
            <ul className="space-y-1">
              {debug.found.map((item) => (
                <li key={`${item.key}:${item.label}`}>
                  <span className="font-mono text-[11px] text-amber-700 dark:text-amber-300">
                    {item.key}
                  </span>
                  {": "}
                  {item.label}
                </li>
              ))}
            </ul>
          ) : (
            <p>None yet.</p>
          )}
        </div>
        <div>
          <p className="mb-1 font-medium text-foreground">Used in search</p>
          <pre className="overflow-x-auto rounded-xl bg-background/80 p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(debug.usedInSearch, null, 2)}
          </pre>
        </div>
        {debug.missing.length ? (
          <div>
            <p className="mb-1 font-medium text-foreground">Missing</p>
            <p>{debug.missing.join(", ")}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function hydrateStoredChat(chat: StoredChat): {
  messages: Message[];
  criteria: UserCriteria | null;
  activePrompt: ClarificationPrompt | null;
} {
  const messages: Message[] = [];
  let criteria: UserCriteria | null = null;
  let activePrompt: ClarificationPrompt | null = null;

  for (const storedMessage of chat.messages) {
    if (storedMessage.role === "user") {
      messages.push({ role: "user", text: storedMessage.content });
      continue;
    }

    const matchResponse = extractStoredMatchResponse(storedMessage);
    const assistantText =
      matchResponse?.assistantMessage ?? storedMessage.content;
    const prompt =
      matchResponse &&
      (matchResponse.type === "chat" || matchResponse.type === "clarification")
        ? matchResponse.prompt
        : undefined;
    messages.push({
      role: "bot",
      text: <p>{assistantText}</p>,
      ...(prompt ? { prompt } : {}),
    });
    activePrompt = prompt ?? null;

    if (matchResponse) {
      criteria = matchResponse.criteria;
      if (
        matchResponse.type === "matches" &&
        matchResponse.recommendations.length
      ) {
        messages.push({
          role: "results",
          matches: matchResponse.recommendations,
          alternativeMatches: matchResponse.alternativeRecommendations ?? [],
          alternativesRevealed: matchResponse.responseMode === "alternatives",
        });
      }
    }
  }

  // Welcome bubble is client-only and never persisted; keep it at the top of every thread.
  return { messages: [...initialMessages, ...messages], criteria, activePrompt };
}

function extractStoredMatchResponse(
  message: StoredChatMessage,
): MatchResponse | null {
  const matchResponse = message.payload?.matchResponse;
  if (!matchResponse || typeof matchResponse !== "object") return null;
  const candidate = matchResponse as Partial<MatchResponse>;
  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.assistantMessage !== "string"
  )
    return null;
  if (!candidate.criteria || typeof candidate.criteria !== "object")
    return null;
  return matchResponse as MatchResponse;
}

function isMissingKey(key: ClarificationPrompt["key"]): key is MissingCriteria {
  return (
    key === "budget" ||
    key === "use_case" ||
    key === "charging_or_range" ||
    key === "vehicle_preferences"
  );
}

function mergeOptionPatches(options: ClarificationOption[]): CriteriaPatch {
  const patch: Record<string, unknown> = {};
  for (const option of options) {
    if (!option.patch) continue;
    for (const [key, value] of Object.entries(option.patch)) {
      if (Array.isArray(value)) {
        const existing = (patch[key] as unknown[] | undefined) ?? [];
        patch[key] = Array.from(new Set([...existing, ...value]));
      } else {
        patch[key] = value;
      }
    }
  }
  return patch as CriteriaPatch;
}

function findLastPromptIndex(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "bot" && message.prompt) return index;
  }
  return -1;
}

function ChatPrompt({
  prompt,
  disabled,
  animate = true,
  onSelect,
}: {
  prompt: ClarificationPrompt;
  disabled: boolean;
  animate?: boolean;
  onSelect: (prompt: ClarificationPrompt, options: ClarificationOption[]) => void;
}) {
  const baseChip =
    "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 pl-1",
        animate && "animate-in fade-in slide-in-from-bottom-1 duration-300",
      )}
    >
      {prompt.options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && onSelect(prompt, [option])}
          className={cn(
            baseChip,
            "border-border bg-background text-foreground hover:bg-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ResultsBlock({
  matches,
  alternativeMatches = [],
  alternativesRevealed = false,
  locked = false,
  animate = true,
  onRevealAlternatives,
}: {
  matches: MatchResult[];
  alternativeMatches?: MatchResult[];
  alternativesRevealed?: boolean;
  locked?: boolean;
  animate?: boolean;
  onRevealAlternatives?: () => void;
}) {
  const [detailMatch, setDetailMatch] = useState<MatchResult | null>(null);
  const groups = groupMatchesByModel(matches);
  const totalListings = matches.length;
  const hiddenAlternativeCount = alternativesRevealed ? 0 : alternativeMatches.length;

  return (
    <>
      <div
        className={cn(
          "space-y-3",
          animate && "animate-in fade-in slide-in-from-bottom-2 duration-500",
        )}
      >
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          {groups.length} model{groups.length === 1 ? "" : "s"} •{" "}
          {totalListings} listing
          {totalListings === 1 ? "" : "s"} found
        </div>
        <div className="relative">
          <div
            className={cn(
              "space-y-4",
              locked ? "pointer-events-none select-none" : "",
            )}
            aria-hidden={locked}
          >
            {groups.map((group, index) => (
              <div
                key={group.key}
                className={cn(
                  animate &&
                    "animate-in fade-in slide-in-from-bottom-4 duration-700 fill-mode-both",
                )}
                style={animate ? { animationDelay: `${index * 280}ms` } : undefined}
              >
                <ModelCard group={group} onOpenDetails={setDetailMatch} />
              </div>
            ))}
          </div>
          {!locked && hiddenAlternativeCount > 0 ? (
            <div className="mt-4 flex justify-start">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRevealAlternatives}
                className="rounded-full"
              >
                <ListPlus className="size-4" aria-hidden="true" />
                Show other options
              </Button>
            </div>
          ) : null}
          {locked ? (
            <>
              <div className="absolute inset-0 z-10 rounded-2xl bg-background/10 backdrop-blur-[12px]" />
              <div className="absolute inset-0 z-20 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => openDemoRegistration()}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-2xl hover:opacity-95"
                >
                  <Lock className="size-4" aria-hidden="true" />
                  Join Demo to unlock
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <DetailsSheet match={detailMatch} onClose={() => setDetailMatch(null)} />
    </>
  );
}

type MatchGroup = {
  key: string;
  title: string;
  matches: MatchResult[];
};

function ModelCard({
  group,
  onOpenDetails,
}: {
  group: MatchGroup;
  onOpenDetails: (match: MatchResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const match = group.matches[0];
  const rangeLabel =
    group.matches.length > 1
      ? maxRangeLabel(group.matches)
      : formatRange(match.vehicle.rangeKm);

  return (
    <div className="rounded-3xl bg-bubble-bot overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <div className="relative size-24 sm:size-28 shrink-0 rounded-2xl overflow-hidden">
          <VehicleImage
            images={match.vehicle.images}
            alt={group.title}
            width={220}
            height={220}
            className="w-full h-full object-cover"
          />
          <span className="absolute top-1.5 left-1.5 bg-match text-match-foreground text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {match.score}%
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display font-bold text-lg truncate">
            {group.title}
          </h2>
          <div className="text-sm text-muted-foreground mt-0.5">
            EV • Range: {rangeLabel}
          </div>
          <div className="font-display font-bold text-base mt-1">
            {formatPriceRange(group.matches)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"
          aria-expanded={open}
        >
          {open
            ? "Hide"
            : `See ${group.matches.length} listing${group.matches.length === 1 ? "" : "s"}`}
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {open ? (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-4 animate-in fade-in slide-in-from-top-1 duration-300">
          {group.matches.map((listing) => (
            <ListingCard
              key={listing.vehicle.id}
              match={listing}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ListingCard({
  match,
  onOpenDetails,
}: {
  match: MatchResult;
  onOpenDetails: (match: MatchResult) => void;
}) {
  const vehicle = match.vehicle;
  const vehicleTitle = `${vehicle.make} ${vehicle.model}`;
  const listingHref = vehicle.listingUrl ?? `/car/${vehicle.id}`;

  return (
    <article className="rounded-3xl bg-white overflow-hidden hover:shadow-[0_20px_50px_-20px_rgba(40,40,80,0.25)] transition-shadow">
      <div className="sm:grid sm:grid-cols-[42%_1fr]">
        <div className="relative sm:row-start-1 sm:col-start-1 sm:h-full">
          <VehicleImage
            images={vehicle.images}
            alt={vehicleTitle}
            width={520}
            height={360}
            className="w-full h-48 sm:h-full sm:absolute sm:inset-0 object-cover"
          />
          <span className="absolute top-3 left-3 bg-match text-match-foreground text-xs font-semibold px-3 py-1.5 rounded-full">
            {match.score}% match
          </span>
          <SaveCarButton
            vehicleId={vehicle.id}
            snapshot={snapshotFromMatch(match)}
            className="absolute top-3 right-3 size-9 rounded-full bg-white flex items-center justify-center shadow text-foreground"
            activeClassName="text-primary"
          />
        </div>

        <div className="p-5 flex flex-col sm:row-start-1 sm:col-start-2">
          <h3 className="font-display font-bold text-lg">{vehicleTitle}</h3>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Chip highlight>{formatCondition(vehicle.condition)}</Chip>
            <Chip>{vehicle.year}</Chip>
            <Chip>EV</Chip>
            <Chip>Range: {formatRange(vehicle.rangeKm)}</Chip>
          </div>

          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {match.explanation}
          </p>

          <div className="mt-4 flex items-end justify-between gap-3">
            <div className="font-display font-bold text-lg leading-tight">
              {formatEUR(match.tco.purchasePriceWithVAT)}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenDetails(match)}
                className="rounded-full bg-muted text-foreground px-4 py-2 text-sm font-semibold hover:bg-muted/80"
              >
                Details
              </button>
              <Link
                href={listingHref}
                className="rounded-full bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold hover:opacity-90"
                onClick={async (event) => {
                  event.preventDefault();
                  if (await requireDemoAccess())
                    window.location.assign(listingHref);
                }}
              >
                Buy →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function DetailsSheet({
  match,
  onClose,
}: {
  match: MatchResult | null;
  onClose: () => void;
}) {
  if (!match) return null;

  const vehicle = match.vehicle;
  const vehicleTitle = `${vehicle.make} ${vehicle.model}`;
  const stats = getVehicleDetailStats(
    vehicle,
    formatEUR(match.tco.purchasePriceWithVAT),
  );
  const detailSections = getVehicleDetailSections(vehicle);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[calc(100vw-40px)] sm:max-w-lg overflow-y-auto p-0 border-0 shadow-2xl"
        style={{
          top: 20,
          bottom: 20,
          right: 20,
          height: "auto",
          borderRadius: 20,
        }}
      >
        <SheetTitle className="sr-only">{vehicleTitle} details</SheetTitle>
        <div className="sticky top-0 z-10 p-5 border-b border-border bg-background rounded-t-[20px]">
          <div className="flex items-center gap-3">
            <div className="relative size-16 shrink-0 rounded-2xl overflow-hidden">
              <VehicleImage
                images={vehicle.images}
                alt={vehicleTitle}
                width={112}
                height={112}
                className="w-full h-full object-cover"
              />
              <span className="absolute top-1 left-1 bg-match text-match-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                {match.score}%
              </span>
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-lg truncate">
                {vehicleTitle}
              </h3>
              <div className="font-display font-bold text-sm mt-0.5">
                {formatEUR(match.tco.purchasePriceWithVAT)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Chip highlight>{formatCondition(vehicle.condition)}</Chip>
            <Chip>{vehicle.year}</Chip>
            <Chip>EV</Chip>
            <Chip>Range: {formatRange(vehicle.rangeKm)}</Chip>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {stats.map(({ label, value }) => (
              <StatTile label={label} value={value} key={label} />
            ))}
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Score breakdown
            </div>
            <div className="rounded-2xl bg-muted/50 p-3 grid grid-cols-1 gap-1.5">
              {formatScoringBreakdown(match).map(({ label, value }) => (
                <ScoreRow label={label} value={value} key={label} />
              ))}
            </div>
          </div>

          {detailSections.map((section) => (
            <div key={section.heading}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {section.heading}
              </div>
              <dl className="rounded-2xl bg-muted/50 p-3 text-sm divide-y divide-border">
                {section.items.map(({ label, value }) => (
                  <SpecRow k={label} v={value} key={label} />
                ))}
              </dl>
            </div>
          ))}

          <Link
            className="inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
            href={vehicle.listingUrl ?? `/car/${vehicle.id}`}
            target={vehicle.listingUrl ? "_blank" : undefined}
            rel={vehicle.listingUrl ? "noreferrer" : undefined}
          >
            {vehicle.listingUrl ? "Open listing" : "Open car page"}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Chip({
  children,
  highlight,
}: {
  children: ReactNode;
  highlight?: boolean;
}) {
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-lg ${
        highlight
          ? "bg-accent text-accent-foreground font-semibold"
          : "bg-muted text-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display font-bold text-[15px] mt-0.5">{value}</div>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const tone = value >= 75 ? "text-foreground" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex-1 text-muted-foreground">{label}</span>
      <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary rounded-full"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`w-10 text-right font-semibold tabular-nums ${tone}`}>
        {value}%
      </span>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-1.5 first:pt-0 last:pb-0">
      <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="flex-1 text-foreground break-all">{v}</dd>
    </div>
  );
}

function ChatRestoreLoader() {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <div
        className="size-5 shrink-0 rounded-full animate-spin [animation-duration:0.9s]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, #a855f7 90deg, #ec4899 270deg, transparent 360deg)",
          WebkitMask: "radial-gradient(circle, transparent 55%, #000 57%)",
          mask: "radial-gradient(circle, transparent 55%, #000 57%)",
        }}
      />
      <span className="text-sm text-muted-foreground">Loading conversation…</span>
    </div>
  );
}

const loadingSteps = [
  "Reading your request…",
  "Matching against inventory",
  "Checking range & charging fit",
  "Scoring tradeoffs",
];

function LoadingBlock() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % loadingSteps.length);
    }, 1600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="max-w-[85%] px-1 py-2 flex items-center gap-3">
        <div
          className="size-6 shrink-0 rounded-full animate-spin [animation-duration:0.9s]"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, #a855f7 90deg, #ec4899 270deg, transparent 360deg)",
            WebkitMask: "radial-gradient(circle, transparent 55%, #000 57%)",
            mask: "radial-gradient(circle, transparent 55%, #000 57%)",
          }}
        />
        <div className="min-w-0">
          <div className="font-display font-semibold text-[15px]">
            FlowRyd is thinking...
          </div>
          <div
            key={step}
            className="text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {loadingSteps[step]}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {[0, 1].map((index) => (
          <SkeletonModelCard key={index} delay={index * 150} />
        ))}
      </div>
    </div>
  );
}

function SkeletonModelCard({ delay }: { delay: number }) {
  return (
    <div
      className="rounded-3xl bg-bubble-bot/50 p-4 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="size-24 sm:size-28 shrink-0 rounded-2xl bg-muted/30" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-2/3 rounded-md bg-muted/30" />
        <div className="h-3 w-1/2 rounded-md bg-muted/25" />
        <div className="h-4 w-1/3 rounded-md bg-muted/30" />
      </div>
      <div className="h-9 w-28 rounded-full bg-muted/30" />
    </div>
  );
}

function groupMatchesByModel(matches: MatchResult[]): MatchGroup[] {
  const groups = new Map<string, MatchGroup>();

  for (const match of matches) {
    const key = `${match.vehicle.make.trim().toLowerCase()}-${match.vehicle.model.trim().toLowerCase()}`;
    const title = `${match.vehicle.make} ${match.vehicle.model}`;
    const group = groups.get(key);

    if (group) {
      group.matches.push(match);
    } else {
      groups.set(key, { key, title, matches: [match] });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort(
        (left, right) =>
          right.score - left.score || right.ragScore - left.ragScore,
      ),
    }))
    .sort(
      (left, right) =>
        (right.matches[0]?.score ?? 0) - (left.matches[0]?.score ?? 0) ||
        (right.matches[0]?.ragScore ?? 0) - (left.matches[0]?.ragScore ?? 0),
    );
}

function formatPriceRange(matches: MatchResult[]) {
  const prices = matches.map((match) => match.tco.purchasePriceWithVAT);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatEUR(min) : `${formatEUR(min)} - ${formatEUR(max)}`;
}

function formatScoringBreakdown(match: MatchResult) {
  return [
    { label: "Price", value: match.scoringBreakdown.priceFit },
    { label: "Range", value: match.scoringBreakdown.rangeFit },
    { label: "Efficiency", value: match.scoringBreakdown.efficiencyFit },
    { label: "Brand", value: match.scoringBreakdown.brandFit },
    { label: "Cargo / seats", value: match.scoringBreakdown.cargoPassengerFit },
    { label: "Reliability", value: match.scoringBreakdown.reliabilityFit },
    { label: "Features", value: match.scoringBreakdown.featureFit },
  ];
}

function maxRangeLabel(matches: MatchResult[]) {
  return formatRange(
    Math.max(...matches.map((match) => match.vehicle.rangeKm)),
  );
}

function snapshotFromMatch(match: MatchResult): SavedCarSnapshot {
  const vehicle = match.vehicle;
  return {
    id: vehicle.id,
    name: `${vehicle.make} ${vehicle.model}`,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    price: formatEUR(match.tco.purchasePriceWithVAT),
    condition: formatCondition(vehicle.condition),
    location: vehicle.location ?? null,
    image: vehicle.images[0] ?? null,
    match: match.score,
    range: formatRange(vehicle.rangeKm),
    mileage:
      vehicle.mileageKm === null
        ? null
        : `${formatNumber(vehicle.mileageKm)} km`,
  };
}

function formatRange(rangeKm: number) {
  return `${formatNumber(rangeKm)} km`;
}

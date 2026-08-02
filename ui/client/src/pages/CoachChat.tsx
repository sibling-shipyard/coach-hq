import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RepoDataGate, AccessRevokedCard } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { ChallengeV2 } from "@/lib/challenge";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { ConversationPane, MobileThreadList, ThreadSidebar } from "@/components/coach-chat/CoachChatWidgets";
import {
  CoachChatAccessRevokedError,
  challengeDayNumber,
  fetchThreads,
  greet,
  sendMessage,
  setThreadStatus as patchThreadStatus,
  threadStatus,
  type ChatMessage,
  type ChatThread,
} from "@/components/coach-chat/coachChatModel";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import "@/components/coach-chat/coach-chat.css";

type MobileView = "list" | "thread" | "new";

export default function CoachChat() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <CoachChatContent data={data} />}
    </RepoDataGate>
  );
}

function CoachChatContent({ data }: { data: RepoData }) {
  const challengeData = data.challenge_v2 as unknown as ChallengeV2;
  const syncStatusData = data.sync_status as SyncStatusPayload;

  const dayNumber = useMemo(() => challengeDayNumber(challengeData), [challengeData]);

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsAccessRevoked, setThreadsAccessRevoked] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>("new");
  const [sending, setSending] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // A4: coach speaks first - true while a greeting turn is in flight (either landing on the
  // page with no today-thread yet, or explicitly starting a new conversation).
  const [greeting, setGreeting] = useState(false);

  const activeThread = threads.find((thread) => thread.id === activeId) ?? null;

  // A4: land on today's thread with Coach already having spoken first - never an empty
  // composer waiting on the athlete to type. Creates (or reuses) it via greet() if today
  // doesn't already have one. list is whatever's already known client-side (avoids a stale
  // closure over `threads` from a prior render).
  async function ensureTodayThread(list: ChatThread[]) {
    const today = list.find((thread) => thread.dayOffset === 0 && threadStatus(thread) === "active");
    if (today) {
      setActiveId(today.id);
      setMobileView((v) => (v === "new" ? "thread" : v));
      return;
    }
    setGreeting(true);
    try {
      const result = await greet();
      setThreads(result.threads);
      setActiveId(result.threadId);
      setMobileView((v) => (v === "new" ? "thread" : v));
    } catch (err: unknown) {
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
        return;
      }
      toast.error(err instanceof Error ? err.message : "Coach couldn't start a conversation — try again");
    } finally {
      setGreeting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setThreadsLoading(true);
    setThreadsAccessRevoked(false);
    setThreadsError(null);
    fetchThreads()
      .then((loaded) => {
        if (cancelled) return;
        setThreads(loaded);
        void ensureTodayThread(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Distinct from a generic failure - the session cookie is valid but GitHub access was
        // revoked/expired, same case useRepoData.ts's accessRevoked covers for the rest of the
        // dashboard. Shown as a "sign in again" card below, not a toast that just disappears.
        if (err instanceof CoachChatAccessRevokedError) {
          setThreadsAccessRevoked(true);
          return;
        }
        setThreadsError(err instanceof Error ? err.message : "Failed to load Coach Chat");
      })
      .finally(() => {
        if (!cancelled) setThreadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (activeId && !threads.some((thread) => thread.id === activeId)) {
      setActiveId(threads.find((thread) => threadStatus(thread) === "active")?.id ?? null);
    }
  }, [threads, activeId]);

  function firstActiveId(list: ChatThread[], excludeId?: string): string | null {
    return list.find((thread) => threadStatus(thread) === "active" && thread.id !== excludeId)?.id ?? null;
  }

  // Delete is immediate and permanent - no archive tier, no restore (ADR 0012 amendment).
  async function deleteThread(id: string) {
    const wasActive = activeId === id;
    if (wasActive) {
      setActiveId(firstActiveId(threads, id));
      setDraft("");
      setMobileView("list");
    }

    // A thread that hasn't been wrapped yet only exists in local state - nothing's committed
    // for the server's PATCH to find. Just drop it client-side.
    if (id.startsWith("local-")) {
      setThreads((prev) => prev.filter((thread) => thread.id !== id));
      return;
    }

    try {
      const next = await patchThreadStatus(id, "deleted");
      setThreads(next);
    } catch (err: unknown) {
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
        return;
      }
      toast.error(err instanceof Error ? err.message : "Failed to delete conversation");
    }
  }

  function startNewConversation() {
    // Not "new" (an empty composer waiting on the athlete) any more - Coach speaks first (A4).
    // greet() reuses today's still-unanswered greeting thread if one exists, or creates a
    // genuinely new one (evicting the oldest of the 7 if already at the cap).
    setActiveId(null);
    setDraft("");
    setMobileView("thread");
    setGreeting(true);
    greet()
      .then((result) => {
        setThreads(result.threads);
        setActiveId(result.threadId);
      })
      .catch((err: unknown) => {
        if (err instanceof CoachChatAccessRevokedError) {
          setThreadsAccessRevoked(true);
          return;
        }
        toast.error(err instanceof Error ? err.message : "Coach couldn't start a conversation — try again");
      })
      .finally(() => setGreeting(false));
  }

  function selectThread(id: string) {
    setActiveId(id);
    setDraft("");
    setMobileView("thread");
  }

  async function appendUserMessage(text: string, targetId: string | null) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // Nothing is persisted server-side until the athlete says wrap/close - the server is
    // stateless per turn, so the client is the only place holding an in-progress conversation.
    // We send our own running history with the message and only trust the server's `threads`
    // back when it reports `closed: true` (a real commit happened); otherwise we append the
    // reply to local state ourselves, same as before Gemini was ever in the loop.
    const priorMessages = targetId ? (threads.find((t) => t.id === targetId)?.messages ?? []) : [];

    setDraft("");
    setMobileView("thread");
    setSending(true);
    const now = Date.now();
    const userMsg: ChatMessage = { id: `u-${now}`, role: "user", text: trimmed };

    // Echo the athlete's own message immediately, matching iOS - don't make them wait for the
    // full Gemini round trip just to see what they typed. newThreadId is only set when this
    // send started a brand-new conversation, so a failure can roll back the whole thread rather
    // than just the message.
    let newThreadId: string | null = null;
    if (targetId) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === targetId ? { ...thread, messages: [...thread.messages, userMsg] } : thread,
        ),
      );
    } else {
      newThreadId = `local-${now}`;
      const created: ChatThread = {
        id: newThreadId,
        dayOffset: 0,
        title: trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed,
        preview: trimmed.slice(0, 80),
        ageLabel: "NOW",
        status: "active",
        messages: [{ id: `d-${now}`, role: "divider", label: "TODAY" }, userMsg],
      };
      setThreads((prev) => [created, ...prev]);
      setActiveId(newThreadId);
    }

    try {
      const result = await sendMessage(targetId, priorMessages, trimmed);

      if (result.closed) {
        setThreads(result.threads);
        setActiveId(result.threadId);
        return;
      }

      // A5: the server detected this thread's repo state changed since we last saw it (most
      // likely a session was wrapped on another device) and re-read fresh context before
      // replying - let the athlete know why Coach's answer might reference something new.
      if (result.stale) {
        toast.info("Coach caught up on changes from your other device");
      }

      const activeThreadId = targetId ?? newThreadId;
      const coachMsg: ChatMessage = { id: `c-${Date.now()}`, role: "coach", paragraphs: [result.reply] };
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === activeThreadId
            ? {
                ...thread,
                preview: result.reply.slice(0, 80),
                ageLabel: "NOW",
                status: "active" as const,
                messages: [...thread.messages, coachMsg],
              }
            : thread,
        ),
      );
    } catch (err: unknown) {
      // Roll back the optimistic echo - either drop the message from an existing thread, or
      // drop the whole thread if this send was what created it.
      if (newThreadId) {
        setThreads((prev) => prev.filter((thread) => thread.id !== newThreadId));
        setActiveId(null);
      } else if (targetId) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === targetId
              ? { ...thread, messages: thread.messages.filter((m) => m.id !== userMsg.id) }
              : thread,
          ),
        );
      }
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
      } else {
        toast.error(err instanceof Error ? err.message : "Coach didn't reply — try again");
      }
      setDraft(trimmed);
    } finally {
      setSending(false);
    }
  }

  const threadActions = {
    onDelete: (id: string) => void deleteThread(id),
  };

  if (threadsAccessRevoked) {
    return <AccessRevokedCard />;
  }

  return (
    <div className="wi-shell">
      <div className="wi-board">
        <InstrumentHeader
          phaseLabel="COACH CHAT"
          mobilePhaseLabel="COACH"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
          currentRoute="/coach-chat"
        />

        {threadsError ? (
          <div className="auth-card-shell">
            <div className="auth-card">
              <h2 className="auth-card__heading">Couldn't load Coach Chat</h2>
              <p className="auth-card__body auth-card__body--error">{threadsError}</p>
              <div className="auth-card__buttons">
                <button
                  type="button"
                  className="auth-card__button auth-card__button--primary"
                  onClick={() => setLoadAttempt((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : (
        <div className="cc-shell">
          <div className="cc-frame">
            <div className="cc-desktop-chat">
              {threadsLoading ? (
                <aside className="cc-sidebar cc-loading" aria-label="Conversations">
                  <span className="cc-loading__spinner" aria-hidden="true" />
                  Loading conversations…
                </aside>
              ) : (
                <ThreadSidebar
                  dayNumber={dayNumber}
                  threads={threads}
                  activeId={activeId}
                  onSelect={selectThread}
                  onNew={startNewConversation}
                  {...threadActions}
                />
              )}
              {activeThread ? (
                <ConversationPane
                  dayNumber={dayNumber}
                  thread={activeThread}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void appendUserMessage(draft, activeId)}
                  pending={sending}
                />
              ) : (
                <section className="cc-pane cc-pane--empty cc-loading" aria-label="Starting conversation">
                  {greeting || threadsLoading ? (
                    <>
                      <span className="cc-loading__spinner" aria-hidden="true" />
                      Coach is opening the conversation…
                    </>
                  ) : (
                    // greeting failed (already toasted) and left no active thread - give the
                    // athlete a way out instead of a permanent silent loading state.
                    <button type="button" className="cc-new-btn" onClick={startNewConversation}>
                      Try again
                    </button>
                  )}
                </section>
              )}
            </div>

            <div className="cc-mobile-chat">
              {mobileView === "list" && threadsLoading ? (
                <section className="cc-mobile-list cc-loading" aria-label="Conversations">
                  <span className="cc-loading__spinner" aria-hidden="true" />
                  Loading conversations…
                </section>
              ) : null}
              {mobileView === "list" && !threadsLoading ? (
                <MobileThreadList
                  dayNumber={dayNumber}
                  threads={threads}
                  activeId={activeId}
                  onSelect={selectThread}
                  onNew={startNewConversation}
                  {...threadActions}
                />
              ) : null}
              {mobileView === "thread" && activeThread ? (
                <ConversationPane
                  dayNumber={dayNumber}
                  thread={activeThread}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void appendUserMessage(draft, activeId)}
                  pending={sending}
                  showBack
                  onBack={() => setMobileView("list")}
                />
              ) : null}
              {mobileView === "new" || (mobileView === "thread" && !activeThread) ? (
                <section className="cc-mobile-list cc-loading" aria-label="Starting conversation">
                  {greeting || threadsLoading ? (
                    <>
                      <span className="cc-loading__spinner" aria-hidden="true" />
                      Coach is opening the conversation…
                    </>
                  ) : (
                    <button type="button" className="cc-new-btn" onClick={startNewConversation}>
                      Try again
                    </button>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

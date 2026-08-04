import { useEffect, useMemo, useRef, useState } from "react";
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
  threadStatus,
  type ChatMessage,
  type ChatThread,
  type GreetResult,
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
  // Audit fix: scoped per-thread (was a single global boolean) - sending in one thread must not
  // disable the composer of a different, unrelated thread the athlete has switched to.
  const [sendingThreadIds, setSendingThreadIds] = useState<Set<string>>(new Set());
  const [loadAttempt, setLoadAttempt] = useState(0);
  // A4: coach speaks first - true while a greeting turn is in flight (either landing on the
  // page with no today-thread yet, or explicitly starting a new conversation).
  const [greeting, setGreeting] = useState(false);

  const activeThread = threads.find((thread) => thread.id === activeId) ?? null;

  // Audit fix: ensureTodayThread (on mount) and startNewConversation (on click) can both fire
  // greet() independently - e.g. clicking "New conversation" before the mount effect's own
  // greet() has resolved. Without sharing the in-flight call, whichever response lands last
  // silently wins and can revert whatever the other one already put on screen. A second caller
  // while one is already in flight now awaits the SAME promise instead of starting a new one.
  const greetInFlightRef = useRef<Promise<GreetResult> | null>(null);
  function greetShared(): Promise<GreetResult> {
    if (greetInFlightRef.current) return greetInFlightRef.current;
    const promise = greet().finally(() => {
      greetInFlightRef.current = null;
    });
    greetInFlightRef.current = promise;
    return promise;
  }

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
      const result = await greetShared();
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

  function startNewConversation() {
    // Not "new" (an empty composer waiting on the athlete) any more - Coach speaks first (A4).
    // greet() reuses today's still-unanswered greeting thread if one exists, or creates a
    // genuinely new one (evicting the oldest of the 7 if already at the cap).
    setActiveId(null);
    setDraft("");
    setMobileView("thread");
    setGreeting(true);
    greetShared()
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
    // Audit fix: `sending` used to be one global flag, so sending in thread A left every OTHER
    // thread's composer disabled with "Coach is replying…" too, until A's request settled -
    // scoped to the specific thread being sent to instead, via sendingThreadIds below.
    if (!trimmed || (targetId && sendingThreadIds.has(targetId))) return;

    // Nothing is persisted server-side until the athlete says wrap/close - the server is
    // stateless per turn, so the client is the only place holding an in-progress conversation.
    // We send our own running history with the message and only trust the server's `threads`
    // back when it reports `closed: true` (a real commit happened); otherwise we append the
    // reply to local state ourselves, same as before Gemini was ever in the loop.
    const priorMessages = targetId ? (threads.find((t) => t.id === targetId)?.messages ?? []) : [];

    setDraft("");
    setMobileView("thread");
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

    const sendKey = targetId ?? newThreadId!;
    setSendingThreadIds((prev) => new Set(prev).add(sendKey));

    try {
      const result = await sendMessage(targetId, priorMessages, trimmed);

      if (result.closed) {
        setThreads(result.threads);
        // Only jump to the newly-closed/reused thread if the athlete is still looking at the
        // thread this send belonged to - if they've since switched away (or deleted it), leave
        // their current view alone instead of silently snapping them back.
        setActiveId((prevActiveId) => (prevActiveId === sendKey ? result.threadId : prevActiveId));
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
      // drop the whole thread if this send was what created it. Only clear activeId if the
      // athlete is still looking at the thread that just failed - same "don't hijack navigation"
      // rule as the success path above.
      if (newThreadId) {
        setThreads((prev) => prev.filter((thread) => thread.id !== newThreadId));
        setActiveId((prevActiveId) => (prevActiveId === newThreadId ? null : prevActiveId));
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
      setSendingThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(sendKey);
        return next;
      });
    }
  }

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
                />
              )}
              {activeThread ? (
                <ConversationPane
                  dayNumber={dayNumber}
                  thread={activeThread}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void appendUserMessage(draft, activeId)}
                  pending={activeThread ? sendingThreadIds.has(activeThread.id) : false}
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
                />
              ) : null}
              {mobileView === "thread" && activeThread ? (
                <ConversationPane
                  dayNumber={dayNumber}
                  thread={activeThread}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void appendUserMessage(draft, activeId)}
                  pending={activeThread ? sendingThreadIds.has(activeThread.id) : false}
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

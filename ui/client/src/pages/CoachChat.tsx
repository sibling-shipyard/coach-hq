import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RepoDataGate, AccessRevokedCard } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { getActivityZoneLoad, type SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import type { Activity } from "@/lib/activities";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import {
  ConversationPane,
  MobileThreadList,
  ThreadSidebar,
} from "@/components/coach-chat/CoachChatWidgets";
import * as Sentry from "@sentry/react";
import {
  clearThreadLocally,
  CoachChatAccessRevokedError,
  CoachChatSaveFailedError,
  activitySync,
  challengeDayNumber,
  computeLocalDayOffset,
  droppedActionToastMessage,
  epochMsFromMessageId,
  fetchProactiveCoachMessage,
  fetchThreads,
  fetchProfileStatus,
  findClientActivity,
  findOrphanedLocalThreadIds,
  greet,
  PENDING_SYNC_THREAD_ID,
  parseProactiveSeed,
  resolveProactiveThread,
  restoreThreadMessagesLocally,
  retryActivityIdsFromThread,
  saveThreadLocally,
  sendMessage,
  syncedActivityList,
  threadStatus,
  truncateTitle,
  type ChatMessage,
  type ChatThread,
  type GreetResult,
  type SyncedActivityRow,
} from "@/components/coach-chat/coachChatModel";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import "@/components/coach-chat/coach-chat.css";

type MobileView = "list" | "thread" | "new";

function provisionalSyncRows(activityIds: string[], activities: unknown): SyncedActivityRow[] {
  return activityIds.map((qualified) => {
    const found = findClientActivity(activities, qualified);
    const id = qualified.includes(":") ? qualified.slice(qualified.indexOf(":") + 1) : qualified;
    const load = found?.hr_zones
      ? getActivityZoneLoad({ hr_zones: found.hr_zones } as Activity)
      : null;
    return {
      id: found?.id ?? id,
      title: found?.name ?? "",
      sport: found?.sport_type ?? "",
      start: found?.start_date_local ?? "",
      duration_s: found?.elapsed_time ?? 0,
      load: load == null ? null : Math.round(load),
    };
  });
}

function syncThreadTitle(rows: SyncedActivityRow[]): string {
  if (rows.length === 1) {
    const title = rows[0]?.title.trim();
    return title && title.length > 0 ? title : "1 session synced";
  }
  return `${rows.length} sessions synced`;
}

export default function CoachChat() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <CoachChatContent data={data} />}
    </RepoDataGate>
  );
}

function CoachChatContent({ data }: { data: RepoData }) {
  const ledger = data.ledger as any;
  const profile = data.profile;
  const syncStatusData = data.sync_status as SyncStatusPayload;

  // Live coach_since from GET profile-status (not dashboard_snapshot — athlete repos often omit
  // profile there). Null until that fetch lands, or when pre-FSP; then ledger/season fallback.
  const [coachSince, setCoachSince] = useState<string | null>(null);
  const dayNumber = useMemo(
    () => challengeDayNumber(coachSince != null ? { coach_since: coachSince } : profile, ledger),
    [coachSince, profile, ledger],
  );
  const requestedProactiveSeed = useMemo(() => parseProactiveSeed(window.location.search), []);

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

  const syncInFlightRef = useRef(false);
  const runActivitySyncRef = useRef<(activityIds: string[]) => Promise<void>>(async () => {});

  async function runActivitySync(activityIds: string[]) {
    if (activityIds.length === 0 || syncInFlightRef.current) return;
    syncInFlightRef.current = true;

    const rows = provisionalSyncRows(activityIds, data.activities);
    const now = Date.now();
    const title = syncThreadTitle(rows);
    const pendingMessages: ChatMessage[] = [
      { id: `d-${now}`, role: "divider", label: "TODAY" },
      {
        id: `c-${now}`,
        role: "coach",
        paragraphs: [],
        attachments: [
          {
            version: 1,
            kind: "synced_activity_list",
            batch_id: "pending",
            activities: rows,
          },
        ],
      },
    ];
    const pendingThread: ChatThread = {
      id: PENDING_SYNC_THREAD_ID,
      dayOffset: 0,
      createdAt: now,
      title,
      preview: rows[0]?.title || "Activity sync",
      ageLabel: "NOW",
      status: "active",
      messages: pendingMessages,
    };

    setThreads((prev) => [
      pendingThread,
      ...prev.filter((thread) => thread.id !== PENDING_SYNC_THREAD_ID),
    ]);
    setActiveId(PENDING_SYNC_THREAD_ID);
    setMobileView("thread");
    saveThreadLocally(PENDING_SYNC_THREAD_ID, pendingMessages);
    setSendingThreadIds((prev) => new Set(prev).add(PENDING_SYNC_THREAD_ID));

    try {
      const result = await activitySync(activityIds);
      clearThreadLocally(PENDING_SYNC_THREAD_ID);
      setThreads((prev) => {
        const local = prev.filter(
          (thread) => thread.id.startsWith("local-") && thread.id !== PENDING_SYNC_THREAD_ID,
        );
        return [...local, ...result.threads];
      });
      setActiveId(result.threadId);
    } catch (err: unknown) {
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
      }
      // Keep the list. Dots stop in finally. Retry is inferred from the list-only turn.
    } finally {
      syncInFlightRef.current = false;
      setSendingThreadIds((prev) => {
        const next = new Set(prev);
        next.delete(PENDING_SYNC_THREAD_ID);
        return next;
      });
    }
  }
  runActivitySyncRef.current = runActivitySync;

  useEffect(() => {
    function onActivitySyncEvent(event: Event) {
      const ids = (event as CustomEvent<{ activityIds?: unknown }>).detail?.activityIds;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || ids.length === 0)
        return;
      void runActivitySyncRef.current(ids as string[]);
    }
    window.addEventListener("coach-chat:activity-sync", onActivitySyncEvent);
    return () => window.removeEventListener("coach-chat:activity-sync", onActivitySyncEvent);
  }, []);

  // coach-chat.ts's handleGreet() no longer commits anything - the server-returned `threadId` is
  // just a fresh, never-persisted id, and `threads` is the existing committed list unchanged.
  // Materialize the greeting as a local-only thread here instead (same "local-" convention
  // appendUserMessage already uses for a brand-new athlete-initiated thread below), and cache it
  // immediately so a refresh before the athlete replies doesn't lose the opener they already saw.
  function materializeGreeting(result: GreetResult, currentThreads: ChatThread[]): ChatThread {
    // Supersede any previous unreplied local greeting instead of accumulating orphans - repeated
    // "New conversation" clicks (or a retry after a failed first greet) would otherwise each
    // leave their own local-storage entry that's never cleared (found via code review: nothing
    // calls clearThreadLocally for an unreplied greeting, only a real close does). Clearing here
    // means at most one unreplied local greeting's cache entry can ever exist at a time.
    for (const thread of currentThreads) {
      if (!thread.id.startsWith("local-") || thread.dayOffset !== 0) continue;
      if (thread.id === PENDING_SYNC_THREAD_ID) continue;
      const real = thread.messages.filter((m) => m.role !== "divider");
      if (real.length === 1 && real[0].role === "coach") clearThreadLocally(thread.id);
    }
    const now = Date.now();
    const thread: ChatThread = {
      id: `local-${now}`,
      dayOffset: 0,
      createdAt: now,
      title: "New conversation",
      preview: result.reply.slice(0, 80),
      ageLabel: "NOW",
      status: "active",
      messages: [
        { id: `d-${now}`, role: "divider", label: "TODAY" },
        { id: `c-${now}`, role: "coach", paragraphs: [result.reply] },
      ],
    };
    saveThreadLocally(thread.id, thread.messages);
    return thread;
  }

  // A4: land on today's thread with Coach already having spoken first - never an empty
  // composer waiting on the athlete to type. Creates (or reuses) it via greet() if today
  // doesn't already have one. list is whatever's already known client-side (avoids a stale
  // closure over `threads` from a prior render).
  async function ensureTodayThread(list: ChatThread[]) {
    const today = list.find(
      (thread) => thread.dayOffset === 0 && threadStatus(thread) === "active",
    );
    if (today) {
      setActiveId(today.id);
      setMobileView((v) => (v === "new" ? "thread" : v));
      return;
    }
    setGreeting(true);
    try {
      const result = await greetShared();
      const greeted = materializeGreeting(result, list);
      setThreads([greeted, ...result.threads]);
      setActiveId(greeted.id);
      setMobileView((v) => (v === "new" ? "thread" : v));
    } catch (err: unknown) {
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
        return;
      }
      // CoachChatRateLimitedError falls through here too - its own message ("Coach is getting a
      // lot of requests...") already explains what happened, same toast treatment as any other
      // error.
      toast.error(
        err instanceof Error ? err.message : "Coach couldn't start a conversation — try again",
      );
    } finally {
      setGreeting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setThreadsLoading(true);
    setThreadsAccessRevoked(false);
    setThreadsError(null);
    Promise.all([
      fetchThreads(),
      requestedProactiveSeed
        ? fetchProactiveCoachMessage(requestedProactiveSeed)
        : Promise.resolve(null),
    ])
      .then(([loaded, proactiveMessage]) => {
        if (cancelled) return;
        // Restore any conversation that was never committed (nothing writes to the repo until a
        // close - see coachChatModel.ts's saveThreadLocally doc comment) and so has no
        // counterpart in `loaded` at all. Without this, a refresh mid-conversation loses
        // everything the athlete typed, even though it was cached correctly the whole time -
        // this scan is what actually finds it again.
        const orphanedIds = findOrphanedLocalThreadIds(loaded.map((t) => t.id));
        const restored: ChatThread[] = orphanedIds.flatMap((id) => {
          const messages = restoreThreadMessagesLocally(id);
          if (!messages || messages.length === 0) return [];
          const lastCoach = [...messages]
            .reverse()
            .find((m): m is Extract<ChatMessage, { role: "coach" }> => m.role === "coach");
          const firstUser = messages.find(
            (m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user",
          );
          const restoredList = lastCoach ? syncedActivityList(lastCoach.attachments) : null;
          const title = firstUser
            ? truncateTitle(firstUser.text, 28)
            : restoredList
              ? syncThreadTitle(restoredList.activities)
              : "New conversation";
          // An orphaned thread never had a server-committed dayOffset - recover a real creation
          // time from the divider message's own id instead of hardcoding "today" (a real bug,
          // found via code review: a stale unreplied greeting from days ago would get treated as
          // today's thread forever, permanently blocking the fresh greeting every open should get).
          const firstDivider = messages.find((m) => m.role === "divider");
          const createdAt = firstDivider
            ? (epochMsFromMessageId(firstDivider.id) ?? undefined)
            : undefined;
          const dayOffset = createdAt !== undefined ? computeLocalDayOffset(createdAt) : 0;
          // An unreplied greeting from a past day has nothing worth keeping - Coach spoke, the
          // athlete never engaged, and a fresh greeting for today already supersedes it. Rather
          // than let it linger forever as a single-message "ghost" thread (correctly dated by
          // the fix above, but still shown), drop it here: clear its cache entry and don't
          // materialize it at all. A same-day unreplied greeting is untouched by this - that's
          // still "come back to what Coach just said," not clutter. An explicitly requested
          // proactive seed is also retained: that URL is the athlete asking to reopen the exact
          // notification thread, even after the latest snapshot has advanced. A list-only
          // activity-sync turn is kept so Retry still has something to re-POST.
          if (!firstUser && dayOffset > 0 && id !== requestedProactiveSeed && !restoredList) {
            clearThreadLocally(id);
            return [];
          }
          const thread: ChatThread = {
            id,
            dayOffset,
            createdAt,
            title,
            preview: lastCoach?.paragraphs.join(" ").trim()
              ? lastCoach.paragraphs.join(" ").slice(0, 80)
              : restoredList?.activities[0]?.title || "",
            ageLabel: dayOffset === 0 ? "NOW" : `D-${dayOffset}`,
            status: "active",
            messages,
          };
          return [thread];
        });
        const combined = [...restored, ...loaded];
        const existingProactiveThread = requestedProactiveSeed
          ? combined.find((thread) => thread.id === requestedProactiveSeed)
          : null;
        const proactiveThread = resolveProactiveThread(
          requestedProactiveSeed,
          proactiveMessage,
          combined,
          requestedProactiveSeed ? restoreThreadMessagesLocally(requestedProactiveSeed) : null,
        );
        if (proactiveThread) {
          const seededThreads = existingProactiveThread ? combined : [proactiveThread, ...combined];
          if (!existingProactiveThread) {
            saveThreadLocally(proactiveThread.id, proactiveThread.messages);
          }
          setThreads(seededThreads);
          setActiveId(proactiveThread.id);
          setMobileView("thread");
          return;
        }
        setThreads(combined);
        void ensureTodayThread(
          requestedProactiveSeed
            ? combined.filter((thread) => thread.id !== requestedProactiveSeed)
            : combined,
        );
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
    // ensureTodayThread is intentionally not a dependency: it is redeclared every render,
    // so listing it would re-run this whole thread load on every render instead of once
    // per load attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt, requestedProactiveSeed]);

  useEffect(() => {
    let cancelled = false;
    fetchProfileStatus()
      .then((status) => {
        if (cancelled) return;
        setCoachSince(status.coachSince);
      })
      .catch((err: unknown) => {
        if (err instanceof CoachChatAccessRevokedError && !cancelled) setThreadsAccessRevoked(true);
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
        const greeted = materializeGreeting(result, threads);
        setThreads([greeted, ...result.threads]);
        setActiveId(greeted.id);
      })
      .catch((err: unknown) => {
        if (err instanceof CoachChatAccessRevokedError) {
          setThreadsAccessRevoked(true);
          return;
        }
        toast.error(
          err instanceof Error ? err.message : "Coach couldn't start a conversation — try again",
        );
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
    // Tracked explicitly rather than re-read from `threads` state later (that closure would be
    // stale mid-async-call) - this is the exact message list saved locally and is also the base
    // the eventual coach reply gets appended onto below.
    const messagesBeforeReply = targetId
      ? [...priorMessages, userMsg]
      : [{ id: `d-${now}`, role: "divider" as const, label: "TODAY" }, userMsg];
    if (targetId) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === targetId ? { ...thread, messages: messagesBeforeReply } : thread,
        ),
      );
      saveThreadLocally(targetId, messagesBeforeReply);
    } else {
      newThreadId = `local-${now}`;
      const created: ChatThread = {
        id: newThreadId,
        dayOffset: 0,
        createdAt: now,
        title: truncateTitle(trimmed, 28),
        preview: trimmed.slice(0, 80),
        ageLabel: "NOW",
        status: "active",
        messages: messagesBeforeReply,
      };
      setThreads((prev) => [created, ...prev]);
      setActiveId(newThreadId);
      saveThreadLocally(newThreadId, messagesBeforeReply);
    }

    const sendKey = targetId ?? newThreadId!;
    setSendingThreadIds((prev) => new Set(prev).add(sendKey));

    try {
      const result = await sendMessage(targetId, priorMessages, trimmed);

      // Every turn commits fully now (C1) - the server's `threads` is always fresh, committed
      // truth, so trust it outright instead of appending the reply to local state ourselves.
      // The local-only cache for this thread (keyed under its pre-commit local id, which no
      // longer means anything once the real committed thread is in result.threads) is done its
      // job and would just be stale/orphaned clutter from here on.
      clearThreadLocally(sendKey);
      setThreads(result.threads);
      // Only jump to the newly-committed/reused thread if the athlete is still looking at the
      // thread this send belonged to - if they've since switched away (or deleted it), leave
      // their current view alone instead of silently snapping them back.
      setActiveId((prevActiveId) => (prevActiveId === sendKey ? result.threadId : prevActiveId));

      // A5: the server detected this thread's repo state changed since we last saw it (most
      // likely another device sent a message first) and re-read fresh context before replying -
      // let the athlete know why Coach's answer might reference something new.
      if (result.stale) {
        toast.info("Coach caught up on changes from your other device");
      }

      // D1 (#736): a firm requirement, not left to Coach's own reply happening to mention it -
      // an explicit, honest indicator whenever something was dropped, and a client-side Sentry
      // capture so the pattern is visible from both ends, not just the backend's. Nothing else
      // needed here - result.threads (trusted above) already carries the committed reply.
      if (result.droppedActions && result.droppedActions.length > 0) {
        toast.info(droppedActionToastMessage(result.droppedActions));
        Sentry.captureMessage("coach-chat: droppedActions in turn response", {
          level: "warning",
          tags: { dropped_count: result.droppedActions.length },
          contexts: { coach_turn: { dropped_actions: result.droppedActions } },
        });
      }
    } catch (err: unknown) {
      // D1 (#736): a save failure that still carries Coach's reply is not "Coach didn't reply" -
      // Gemini did its job, only the write failed. Keep the optimistic user message and the
      // reply text (rather than rolling everything back like every other failure below) and show
      // a clear, distinct "couldn't save that" indicator instead.
      if (err instanceof CoachChatSaveFailedError) {
        const activeThreadId = targetId ?? newThreadId;
        const coachMsg: ChatMessage = {
          id: `c-${Date.now()}`,
          role: "coach",
          paragraphs: [err.reply],
        };
        const updatedMessages = [...messagesBeforeReply, coachMsg];
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === activeThreadId ? { ...thread, messages: updatedMessages } : thread,
          ),
        );
        if (activeThreadId) saveThreadLocally(activeThreadId, updatedMessages);
        toast.error("Coach replied, but I couldn't save it — try again?");
        return;
      }
      // Roll back the optimistic echo - either drop the message from an existing thread, or
      // drop the whole thread if this send was what created it. Only clear activeId if the
      // athlete is still looking at the thread that just failed - same "don't hijack navigation"
      // rule as the success path above.
      if (newThreadId) {
        setThreads((prev) => prev.filter((thread) => thread.id !== newThreadId));
        setActiveId((prevActiveId) => (prevActiveId === newThreadId ? null : prevActiveId));
        clearThreadLocally(newThreadId);
      } else if (targetId) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === targetId
              ? { ...thread, messages: thread.messages.filter((m) => m.id !== userMsg.id) }
              : thread,
          ),
        );
        saveThreadLocally(targetId, priorMessages);
      }
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
      } else {
        // CoachChatRateLimitedError falls through here too - its own message already explains
        // what happened, same toast treatment (including duration) as any other error. This is
        // Coach never getting to reply at all - distinct from the CoachChatSaveFailedError case
        // above, which keeps the reply on screen.
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
                    activities={data.activities}
                    onRetrySync={
                      activeThread && retryActivityIdsFromThread(activeThread)
                        ? () => {
                            const ids = retryActivityIdsFromThread(activeThread);
                            if (ids) void runActivitySync(ids);
                          }
                        : undefined
                    }
                  />
                ) : (
                  <section
                    className="cc-pane cc-pane--empty cc-loading"
                    aria-label="Starting conversation"
                  >
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
                    activities={data.activities}
                    onRetrySync={
                      activeThread && retryActivityIdsFromThread(activeThread)
                        ? () => {
                            const ids = retryActivityIdsFromThread(activeThread);
                            if (ids) void runActivitySync(ids);
                          }
                        : undefined
                    }
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

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RepoDataGate } from "@/components/RepoDataGate";
import { GitHubAuthButton } from "@/components/login/GitHubAuthButton";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { ChallengeV2 } from "@/lib/challenge";
import { parseCurrentWeek } from "@/lib/currentWeek";
import { adaptCurrentWeek } from "@/components/home-warm/currentWeekAdapter";
import { buildLiveWeekContract } from "@/components/home-warm/liveWeekContract";
import { buildWarmHomeModel, type SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { buildEngineSnapshot } from "@/components/home-warm/WarmInstrumentHome";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import {
  ConversationPane,
  EmptyChatPane,
  MobileThreadList,
  ThreadSidebar,
} from "@/components/coach-chat/CoachChatWidgets";
import {
  CoachChatAccessRevokedError,
  challengeDayNumber,
  fetchThreads,
  sendMessage,
  setThreadStatus as patchThreadStatus,
  threadStatus,
  type ChatMessage,
  type ChatStarter,
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
  const activities = data.activities as Activity[];
  const challengeData = data.challenge_v2 as unknown as ChallengeV2;
  const syncStatusData = data.sync_status as SyncStatusPayload;

  const currentWeekRt = parseCurrentWeek(data.current_week);
  const currentWeek =
    currentWeekRt.availability.available && currentWeekRt.data
      ? adaptCurrentWeek(currentWeekRt.data, currentWeekRt.availability, activities)
      : undefined;

  const dayNumber = useMemo(() => challengeDayNumber(challengeData), [challengeData]);

  const engineLoad = useMemo(() => {
    const contract = currentWeek ?? buildLiveWeekContract(activities, challengeData);
    const model = buildWarmHomeModel(activities, challengeData, syncStatusData, contract);
    return buildEngineSnapshot(activities, model.engine).load;
  }, [activities, challengeData, currentWeek, syncStatusData]);

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsAccessRevoked, setThreadsAccessRevoked] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mobileView, setMobileView] = useState<MobileView>("new");
  const [sending, setSending] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const activeThread = threads.find((thread) => thread.id === activeId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setThreadsLoading(true);
    setThreadsAccessRevoked(false);
    setThreadsError(null);
    fetchThreads()
      .then((loaded) => {
        if (cancelled) return;
        setThreads(loaded);
        setActiveId(loaded.find((thread) => threadStatus(thread) === "active")?.id ?? null);
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

  async function updateStatus(id: string, status: ChatThread["status"]) {
    const wasActive = activeId === id;
    if (wasActive && status !== "active") {
      setActiveId(firstActiveId(threads, id));
      setDraft("");
      setMobileView("list");
    }

    // A thread that hasn't been wrapped yet only exists in local state - nothing's committed
    // for the server's PATCH to find. Calling it anyway would return the server's committed
    // thread list, silently dropping this local-only thread out of view. Handle it purely
    // client-side instead: delete removes it (nothing was ever saved to lose), archive just
    // hides it from the active list for this session.
    if (id.startsWith("local-")) {
      if (status === "deleted") {
        setThreads((prev) => prev.filter((thread) => thread.id !== id));
      } else {
        setThreads((prev) =>
          prev.map((thread) => (thread.id === id ? { ...thread, status: status ?? "active" } : thread)),
        );
      }
      return;
    }

    try {
      const next = await patchThreadStatus(id, status ?? "active");
      setThreads(next);
    } catch (err: unknown) {
      if (err instanceof CoachChatAccessRevokedError) {
        setThreadsAccessRevoked(true);
        return;
      }
      toast.error(err instanceof Error ? err.message : "Failed to update conversation");
    }
  }

  function archiveThread(id: string) {
    void updateStatus(id, "archived");
  }

  function unarchiveThread(id: string) {
    void updateStatus(id, "active");
  }

  function deleteThread(id: string) {
    void updateStatus(id, "deleted");
  }

  function restoreThread(id: string) {
    void updateStatus(id, "active");
  }

  function deleteForever(id: string) {
    // Sending "deleted" again on an already-deleted thread is how the server (ADR 0012)
    // distinguishes a real hard delete from an ordinary soft-delete.
    void updateStatus(id, "deleted");
  }

  function startNewConversation() {
    setActiveId(null);
    setDraft("");
    setMobileView("new");
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

    try {
      const result = await sendMessage(targetId, priorMessages, trimmed);

      if (result.closed) {
        setThreads(result.threads);
        setActiveId(result.threadId);
        return;
      }

      const coachMsg: ChatMessage = { id: `c-${now}`, role: "coach", paragraphs: [result.reply] };

      if (targetId) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === targetId
              ? {
                  ...thread,
                  preview: result.reply.slice(0, 80),
                  ageLabel: "NOW",
                  status: "active" as const,
                  archivedAt: undefined,
                  deletedAt: undefined,
                  messages: [...thread.messages, userMsg, coachMsg],
                }
              : thread,
          ),
        );
      } else {
        const id = `local-${now}`;
        const created: ChatThread = {
          id,
          dayOffset: 0,
          title: trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed,
          preview: result.reply.slice(0, 80),
          ageLabel: "NOW",
          status: "active",
          messages: [{ id: `d-${now}`, role: "divider", label: "TODAY" }, userMsg, coachMsg],
        };
        setThreads((prev) => [created, ...prev]);
        setActiveId(id);
      }
    } catch (err: unknown) {
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

  function handleStarter(starter: ChatStarter) {
    void appendUserMessage(starter.label, null);
  }

  const threadActions = {
    onArchive: archiveThread,
    onUnarchive: unarchiveThread,
    onDelete: deleteThread,
    onRestore: restoreThread,
    onDeleteForever: deleteForever,
  };

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

        {threadsAccessRevoked ? (
          <div className="auth-card-shell">
            <div className="auth-card">
              <h2 className="auth-card__heading">Your GitHub access expired</h2>
              <p className="auth-card__body">
                Your session is still active, but GitHub access was revoked or expired - this
                happens if you uninstalled the App or removed its access on GitHub's side. Sign
                in again to reconnect Coach Chat.
              </p>
              <div className="auth-card__buttons">
                <GitHubAuthButton className="auth-card__button auth-card__button--primary">
                  Sign in again
                </GitHubAuthButton>
              </div>
            </div>
          </div>
        ) : threadsError ? (
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
                <EmptyChatPane
                  dayNumber={dayNumber}
                  engineLoad={engineLoad}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void appendUserMessage(draft, null)}
                  onStarter={handleStarter}
                  pending={sending}
                />
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
              {mobileView === "new" ? (
                <EmptyChatPane
                  dayNumber={dayNumber}
                  engineLoad={engineLoad}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void appendUserMessage(draft, null)}
                  onStarter={handleStarter}
                  pending={sending}
                  showBack
                  onBack={() => setMobileView("list")}
                />
              ) : null}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

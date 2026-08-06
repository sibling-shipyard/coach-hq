import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import {
  CHAT_STARTERS,
  type ChatMessage,
  type ChatStarter,
  type ChatThread,
  type CoachChip,
  threadAgeDisplay,
  threadDayLabel,
  threadDividerLabel,
  threadStatus,
} from "./coachChatModel";

function PlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15">
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SendIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <line x1="12" y1="19" x2="12" y2="5" stroke="currentColor" strokeWidth="2" />
      <polyline points="6 11 12 5 18 11" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function ReadingIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="M20 5v5h-5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 19v-5h5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19.6 10a8 8 0 0 0-13.2-3.4L4 9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.4 14a8 8 0 0 0 13.2 3.4L20 15" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
      <polyline points="15 18 9 12 15 6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CoachMarkIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="26" viewBox="0 0 24 24" width="26">
      <path d="M4 15a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" />
      <line x1="12" y1="15" x2="16.5" y2="10.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="15" r="1.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function StarterIcon({ icon }: { icon: ChatStarter["icon"] }) {
  if (icon === "week") {
    return (
      <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17">
        <path d="M3 3v18h18" stroke="#7f3728" strokeWidth="1.8" />
        <path d="M7 14l3-4 3 2 4-6" stroke="#7f3728" strokeWidth="1.8" />
      </svg>
    );
  }
  if (icon === "cold") {
    return (
      <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17">
        <circle cx="12" cy="12" r="9" stroke="#4f587a" strokeWidth="1.8" />
        <line x1="12" y1="8" x2="12" y2="12" stroke="#4f587a" strokeWidth="1.8" />
        <line x1="12" y1="16" x2="12.01" y2="16" stroke="#4f587a" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17">
      <circle cx="12" cy="18.4" r="2.4" stroke="#315a4a" strokeWidth="1.8" />
      <path
        d="M10.7 16.4 6.6 6M12 16V5M13.3 16.4 17.4 6M6.6 6Q12 8.6 17.4 6"
        stroke="#315a4a"
        strokeWidth="1.8"
      />
    </svg>
  );
}

// `highlights` (a {{token}} inline-styling scheme) is a type-level leftover - the Gemini response
// schema (ui/api/coach-chat.ts) has no `highlights` field, so the server never actually populates
// it. Kept as a defensive fallback only, in case that ever changes again - a coach message with
// highlights renders with the old token-splitting behavior instead of markdown, rather than
// silently losing the highlight styling by running both parsers against the same text.
function renderCoachTextWithHighlights(
  text: string,
  highlights: Record<string, { text: string; color: string }>,
): ReactNode {
  const parts = text.split(/(\{\{[a-zA-Z0-9_]+\}\})/g);
  return parts.map((part, index) => {
    const match = part.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
    if (!match) return <span key={index}>{part}</span>;
    const highlight = highlights[match[1]];
    if (!highlight) return <span key={index}>{part}</span>;
    return (
      <span
        className="cc-highlight"
        key={index}
        style={{ color: highlight.color }}
      >
        {highlight.text}
      </span>
    );
  });
}

// Coach replies can contain **bold**/lists (encouraged now for structured content like workout
// plans, see coach-chat.ts's <instructions> block) - render real markdown instead of literal
// asterisks/dashes. react-markdown builds a real React element tree (no dangerouslySetInnerHTML),
// so this is safe under the existing strict CSP (script-src 'self'). Only a small allowlist of
// block/inline elements is styled via cc-md-* classes in coach-chat.css - anything else falls
// back to react-markdown's plain default rendering.
function renderCoachText(text: string, highlights?: Record<string, { text: string; color: string }>): ReactNode {
  if (highlights && Object.keys(highlights).length > 0) {
    return renderCoachTextWithHighlights(text, highlights);
  }
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="cc-md-p">{children}</p>,
        ul: ({ children }) => <ul className="cc-md-list">{children}</ul>,
        ol: ({ children }) => <ol className="cc-md-list">{children}</ol>,
        li: ({ children }) => <li className="cc-md-list-item">{children}</li>,
        strong: ({ children }) => <strong className="cc-md-strong">{children}</strong>,
        a: ({ children, href }) => (
          <a className="cc-md-link" href={href} rel="noreferrer" target="_blank">
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function CoachChips({ chips }: { chips: CoachChip[] }) {
  return (
    <div className="cc-chips">
      {chips.map((chip, index) => {
        if (chip.kind === "engine") {
          return (
            <div className="cc-chip cc-chip--engine" key={`${chip.label}-${index}`}>
              <span className="cc-chip__label">{chip.label}</span>
              <span className="cc-chip__value">{chip.value}</span>
              <span className="cc-chip__status">{chip.status}</span>
            </div>
          );
        }
        return (
          <div className="cc-chip cc-chip--sport" key={`${chip.label}-${index}`}>
            <span className="cc-chip__swatch" style={{ background: chip.color }} />
            <span className="cc-chip__sport-label" style={{ color: chip.color }}>
              {chip.label}
            </span>
            <span className="cc-chip__note">{chip.note}</span>
          </div>
        );
      })}
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="cc-coach-wrap" aria-label="Coach is thinking">
      <div className="cc-bubble cc-bubble--coach cc-bubble--thinking">
        <span className="cc-thinking-dot" />
        <span className="cc-thinking-dot" />
        <span className="cc-thinking-dot" />
      </div>
    </div>
  );
}

function MessageList({ thread, pending }: { thread: ChatThread; pending?: boolean }) {
  const messages = thread.messages;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  // Index of the last *coach* message, not the last array item - the optimistic user-message
  // echo (CoachChat.tsx's appendUserMessage) can land as the newest item before the reply
  // arrives, which would otherwise make the previous coach bubble's signature flicker off then
  // back on once the reply lands.
  let lastCoachIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === "coach") lastCoachIndex = index;
  });

  // Only the FIRST divider gets the dynamic label - a thread only ever has one in practice (the
  // opener), but guarding by index rather than "every divider" avoids surprises if that ever
  // changes.
  const firstDividerIndex = messages.findIndex((m) => m.role === "divider");

  return (
    <div className="cc-messages" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((message, messageIndex) => {
        if (message.role === "divider") {
          // The server stores this label frozen at creation time ("TODAY · 2:00 AM"), which
          // reads as wrong forever once the thread is no longer from today - compute a fresh
          // one from the thread's own dayOffset/createdAt instead of trusting the stored string.
          const label = messageIndex === firstDividerIndex ? threadDividerLabel(thread) : message.label;
          return (
            <div className="cc-divider" key={message.id}>
              {label}
            </div>
          );
        }
        if (message.role === "user") {
          return (
            <div className="cc-bubble cc-bubble--user" key={message.id}>
              {message.text}
            </div>
          );
        }
        // Sign only the most recent reply, not every bubble - a real conversation doesn't
        // re-sign every line, and it read as noisy repeated on every turn.
        const isLastMessage = messageIndex === lastCoachIndex;
        return (
          <div className="cc-coach-wrap" key={message.id}>
            <div className="cc-bubble cc-bubble--coach">
              {message.paragraphs.map((paragraph, index) => (
                <div className="cc-coach-copy" key={`${message.id}-p${index}`}>
                  {renderCoachText(paragraph, message.highlights)}
                  {index === 0 && message.chips ? <CoachChips chips={message.chips} /> : null}
                </div>
              ))}
              {isLastMessage ? <div className="cc-signature">— PHELPS</div> : null}
            </div>
          </div>
        );
      })}
      {pending ? <ThinkingBubble /> : null}
      <div ref={endRef} />
    </div>
  );
}

function Composer({
  placeholder,
  value,
  onChange,
  onSubmit,
  round = false,
  disabled = false,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  round?: boolean;
  disabled?: boolean;
}) {
  const inputId = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    onSubmit();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (disabled) return;
      onSubmit();
    }
  }

  return (
    <form className={`cc-composer ${round ? "is-round" : ""}`} onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={inputId}>
        Message Coach
      </label>
      <textarea
        id={inputId}
        className="cc-composer__input"
        placeholder={placeholder}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        aria-label="Send message"
        className="cc-composer__send"
        disabled={disabled || !value.trim()}
        type="submit"
      >
        <SendIcon size={round ? 16 : 18} />
      </button>
    </form>
  );
}

function ThreadRow({
  dayNumber,
  thread,
  active,
  onSelect,
}: {
  dayNumber: number;
  thread: ChatThread;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const status = threadStatus(thread);

  return (
    <button
      className={`cc-thread-row ${active ? "is-active" : ""} ${status !== "active" ? `is-${status}` : ""}`}
      onClick={() => onSelect(thread.id)}
      type="button"
    >
      <div className="cc-thread-row__top">
        <span className={`cc-thread-row__day ${active ? "is-active" : ""}`}>
          {threadDayLabel(dayNumber, thread.dayOffset)}
        </span>
        <span className="cc-thread-row__title">{thread.title}</span>
        <span className="cc-thread-row__age">{threadAgeDisplay(thread)}</span>
      </div>
      <div className="cc-thread-row__preview">{thread.preview}</div>
    </button>
  );
}

function ThreadSections({
  dayNumber,
  threads,
  activeId,
  onSelect,
}: {
  dayNumber: number;
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  // Every thread returned by the server is active - retention (ADR 0012 amendment) drops the
  // oldest automatically once past MAX_RETAINED_THREADS, so there's no separate archived section.
  const recent = threads.filter((thread) => threadStatus(thread) === "active");

  return (
    <>
      <div className="cc-sidebar__section-row">
        <span className="cc-sidebar__section">RECENT</span>
        <span className="cc-sidebar__hint">LAST 7 THREADS</span>
      </div>
      {recent.length === 0 ? (
        <div className="cc-thread-empty">No open conversations</div>
      ) : (
        recent.map((thread) => (
          <ThreadRow
            key={thread.id}
            dayNumber={dayNumber}
            thread={thread}
            active={thread.id === activeId}
            onSelect={onSelect}
          />
        ))
      )}
    </>
  );
}

export function ThreadSidebar({
  dayNumber,
  threads,
  activeId,
  onSelect,
  onNew,
}: {
  dayNumber: number;
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="cc-sidebar" aria-label="Conversations">
      <div className="cc-sidebar__head">
        <div className="cc-sidebar__brand">
          <span className="cc-sidebar__title">COACH</span>
          <span className="cc-sidebar__day">DAY {dayNumber}</span>
        </div>
        <button className="cc-new-btn" onClick={onNew} type="button">
          <PlusIcon />
          New conversation
        </button>
      </div>
      <div className="cc-sidebar__list">
        <ThreadSections dayNumber={dayNumber} threads={threads} activeId={activeId} onSelect={onSelect} />
      </div>
    </aside>
  );
}

export function ConversationPane({
  dayNumber,
  thread,
  draft,
  onDraftChange,
  onSend,
  onBack,
  showBack,
  pending,
}: {
  dayNumber: number;
  thread: ChatThread;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onBack?: () => void;
  showBack?: boolean;
  pending?: boolean;
}) {
  return (
    <section className="cc-pane" aria-label={thread.title}>
      <div className="cc-pane__header">
        {showBack ? (
          <button aria-label="Back to conversations" className="cc-back" onClick={onBack} type="button">
            <BackIcon />
          </button>
        ) : null}
        <span className="cc-pane__day">{threadDayLabel(dayNumber, thread.dayOffset)}</span>
        <span className="cc-pane__title">{thread.title}</span>
        {thread.statusLabel ? (
          <span className="cc-pane__status">
            <ReadingIcon />
            {thread.statusLabel}
          </span>
        ) : null}
      </div>
      <MessageList thread={thread} pending={pending} />
      <div className="cc-pane__footer">
        <Composer
          placeholder={pending ? "Coach is replying…" : "Ask Coach anything…"}
          value={draft}
          onChange={onDraftChange}
          onSubmit={onSend}
          disabled={pending}
        />
        <p className="cc-pane__footnote">
          COACH SEES YOUR LOAD, LEDGER, PLAN &amp; SPORT ANALYTICS · NOT SHARED BETWEEN ACCOUNTS
        </p>
      </div>
    </section>
  );
}

export function EmptyChatPane({
  dayNumber,
  engineLoad,
  draft,
  onDraftChange,
  onSend,
  onStarter,
  onBack,
  showBack,
  pending,
  pickupThread,
  onPickup,
}: {
  dayNumber: number;
  engineLoad: number | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStarter: (starter: ChatStarter) => void;
  onBack?: () => void;
  showBack?: boolean;
  pending?: boolean;
  /** Most recent still-open (active, non-today) thread, if any - offered as a shortcut. */
  pickupThread?: ChatThread | null;
  onPickup?: (id: string) => void;
}) {
  const loadLabel = engineLoad !== null ? String(engineLoad) : "—";
  const mobileChrome = Boolean(showBack);

  return (
    <section className="cc-pane cc-pane--empty" aria-label="New conversation">
      <div className={`cc-pane__header ${mobileChrome ? "cc-pane__header--mobile" : ""}`}>
        {showBack ? (
          <button aria-label="Back to conversations" className="cc-back" onClick={onBack} type="button">
            <BackIcon />
          </button>
        ) : null}
        <span className="cc-pane__day">D-{dayNumber}</span>
        <span className="cc-pane__title">New conversation</span>
        {mobileChrome ? (
          <span className="cc-pane__status cc-pane__status--icon-only" aria-hidden="true">
            <ReadingIcon />
          </span>
        ) : null}
      </div>

      <div className={`cc-empty ${mobileChrome ? "" : "cc-empty--desktop"}`}>
        <div className="cc-empty__hero">
          <div className="cc-empty__mark">
            <CoachMarkIcon />
          </div>
          <p className="cc-empty__greeting">
            Morning. I&apos;ve got your week open —{" "}
            <span className="cc-empty__load">{loadLabel}</span>
            {engineLoad !== null ? ", still in the band" : ""}. What&apos;s on your mind?
          </p>
          <div className="cc-signature">— PHELPS</div>
        </div>

        {pickupThread ? (
          <div className="cc-starters">
            <div className="cc-starters__label">PICK UP WHERE YOU LEFT OFF</div>
            <button
              className="cc-starter"
              type="button"
              onClick={() => onPickup?.(pickupThread.id)}
            >
              <StarterIcon icon="week" />
              <span>{pickupThread.title}</span>
            </button>
          </div>
        ) : null}

        <div className="cc-starters">
          <div className="cc-starters__label">START WITH</div>
          {CHAT_STARTERS.map((starter) => (
            <button
              className="cc-starter"
              key={starter.id}
              onClick={() => onStarter(starter)}
              type="button"
            >
              <StarterIcon icon={starter.icon} />
              <span>{starter.label}</span>
            </button>
          ))}
        </div>

        {pending ? (
          <div className="cc-coach-wrap cc-coach-wrap--empty">
            <div className="cc-bubble cc-bubble--coach cc-bubble--thinking">
              <span className="cc-thinking-dot" />
              <span className="cc-thinking-dot" />
              <span className="cc-thinking-dot" />
            </div>
          </div>
        ) : null}
        <Composer
          placeholder={pending ? "Coach is replying…" : mobileChrome ? "Message Coach…" : "Ask Coach anything…"}
          value={draft}
          onChange={onDraftChange}
          onSubmit={onSend}
          round={mobileChrome}
          disabled={pending}
        />
        {!mobileChrome ? (
          <p className="cc-pane__footnote">
            COACH SEES YOUR LOAD, LEDGER, PLAN &amp; SPORT ANALYTICS · NOT SHARED BETWEEN ACCOUNTS
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function MobileThreadList({
  dayNumber,
  threads,
  activeId,
  onSelect,
  onNew,
}: {
  dayNumber: number;
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <section className="cc-mobile-list" aria-label="Conversations">
      <div className="cc-mobile-list__head">
        <Link aria-label="Back to HQ" className="cc-back" href="/">
          <BackIcon />
        </Link>
        <div className="cc-sidebar__brand">
          <span className="cc-sidebar__title">COACH</span>
          <span className="cc-sidebar__day">DAY {dayNumber}</span>
        </div>
      </div>
      <button className="cc-new-btn" onClick={onNew} type="button">
        <PlusIcon />
        New conversation
      </button>
      <ThreadSections dayNumber={dayNumber} threads={threads} activeId={activeId} onSelect={onSelect} />
    </section>
  );
}

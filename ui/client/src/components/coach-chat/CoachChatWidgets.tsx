import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "wouter";
import {
  CHAT_STARTERS,
  MAX_RETAINED_THREADS,
  type ChatMessage,
  type ChatStarter,
  type ChatThread,
  type ChatThreadStatus,
  type CoachChip,
  threadDayLabel,
  threadStatus,
} from "./coachChatModel";

type ThreadMenuState = {
  threadId: string;
  status: ChatThreadStatus;
  x: number;
  y: number;
};
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

function renderCoachText(
  text: string,
  highlights?: Record<string, { text: string; color: string }>,
): ReactNode {
  if (!highlights) return text;
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

function MessageList({ messages, pending }: { messages: ChatMessage[]; pending?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  return (
    <div className="cc-messages" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((message) => {
        if (message.role === "divider") {
          return (
            <div className="cc-divider" key={message.id}>
              {message.label}
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
        return (
          <div className="cc-coach-wrap" key={message.id}>
            <div className="cc-bubble cc-bubble--coach">
              {message.paragraphs.map((paragraph, index) => (
                <div className="cc-coach-copy" key={`${message.id}-p${index}`}>
                  {renderCoachText(paragraph, message.highlights)}
                  {index === 0 && message.chips ? <CoachChips chips={message.chips} /> : null}
                </div>
              ))}
              <div className="cc-signature">— PHELPS</div>
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

function ThreadContextMenu({
  menu,
  onClose,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onDeleteForever,
}: {
  menu: ThreadMenuState;
  onClose: () => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function handleScroll() {
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  useEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [menu.x, menu.y]);

  return (
    <div
      ref={menuRef}
      className="cc-ctx"
      role="menu"
      aria-label="Conversation actions"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.status === "deleted" ? (
        <>
          <button
            className="cc-ctx__item"
            role="menuitem"
            type="button"
            onClick={() => {
              onRestore(menu.threadId);
              onClose();
            }}
          >
            Restore
          </button>
          <button
            className="cc-ctx__item cc-ctx__item--danger"
            role="menuitem"
            type="button"
            onClick={() => {
              onDeleteForever(menu.threadId);
              onClose();
            }}
          >
            Delete forever
          </button>
        </>
      ) : (
        <>
          {menu.status === "archived" ? (
            <button
              className="cc-ctx__item"
              role="menuitem"
              type="button"
              onClick={() => {
                onUnarchive(menu.threadId);
                onClose();
              }}
            >
              Unarchive
            </button>
          ) : (
            <button
              className="cc-ctx__item"
              role="menuitem"
              type="button"
              onClick={() => {
                onArchive(menu.threadId);
                onClose();
              }}
            >
              Archive
            </button>
          )}
          <button
            className="cc-ctx__item cc-ctx__item--danger"
            role="menuitem"
            type="button"
            onClick={() => {
              onDelete(menu.threadId);
              onClose();
            }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function ThreadRow({
  dayNumber,
  thread,
  active,
  onSelect,
  onOpenMenu,
}: {
  dayNumber: number;
  thread: ChatThread;
  active: boolean;
  onSelect: (id: string) => void;
  onOpenMenu: (state: ThreadMenuState) => void;
}) {
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const status = threadStatus(thread);

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function openMenu(x: number, y: number) {
    onOpenMenu({
      threadId: thread.id,
      status,
      x,
      y,
    });
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse") return;
    longPressFired.current = false;
    clearLongPress();
    const { clientX, clientY } = event;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      openMenu(clientX, clientY);
    }, 520);
  }

  function handleClick() {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onSelect(thread.id);
  }

  return (
    <button
      className={`cc-thread-row ${active ? "is-active" : ""} ${status !== "active" ? `is-${status}` : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      type="button"
    >
      <div className="cc-thread-row__top">
        <span className={`cc-thread-row__day ${active ? "is-active" : ""}`}>
          {threadDayLabel(dayNumber, thread.dayOffset)}
        </span>
        <span className="cc-thread-row__title">{thread.title}</span>
        <span className="cc-thread-row__age">{thread.ageLabel}</span>
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
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onDeleteForever,
}: {
  dayNumber: number;
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
}) {
  const [menu, setMenu] = useState<ThreadMenuState | null>(null);
  const recent = threads.filter((thread) => threadStatus(thread) === "active");
  const archived = threads.filter((thread) => threadStatus(thread) === "archived");
  const deleted = threads.filter((thread) => threadStatus(thread) === "deleted");

  return (
    <>
      <div className="cc-sidebar__section">RECENT</div>
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
            onOpenMenu={setMenu}
          />
        ))
      )}
      {archived.length > 0 ? (
        <>
          <div className="cc-sidebar__section cc-sidebar__section--spaced">ARCHIVED</div>
          <div className="cc-sidebar__hint">Newest {MAX_RETAINED_THREADS} kept — oldest drop off automatically</div>
          {archived.map((thread) => (
            <ThreadRow
              key={thread.id}
              dayNumber={dayNumber}
              thread={thread}
              active={thread.id === activeId}
              onSelect={onSelect}
              onOpenMenu={setMenu}
            />
          ))}
        </>
      ) : null}
      {deleted.length > 0 ? (
        <>
          <div className="cc-sidebar__section cc-sidebar__section--spaced">DELETED</div>
          <div className="cc-sidebar__hint">Restore, or delete forever</div>
          {deleted.map((thread) => (
            <ThreadRow
              key={thread.id}
              dayNumber={dayNumber}
              thread={thread}
              active={thread.id === activeId}
              onSelect={onSelect}
              onOpenMenu={setMenu}
            />
          ))}
        </>
      ) : null}
      {menu ? (
        <ThreadContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
          onRestore={onRestore}
          onDeleteForever={onDeleteForever}
        />
      ) : null}
    </>
  );
}

export function ThreadSidebar({
  dayNumber,
  threads,
  activeId,
  onSelect,
  onNew,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onDeleteForever,
}: {
  dayNumber: number;
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
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
        <ThreadSections
          dayNumber={dayNumber}
          threads={threads}
          activeId={activeId}
          onSelect={onSelect}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
          onRestore={onRestore}
          onDeleteForever={onDeleteForever}
        />
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
      <MessageList messages={thread.messages} pending={pending} />
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
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onDeleteForever,
}: {
  dayNumber: number;
  threads: ChatThread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
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
      <ThreadSections
        dayNumber={dayNumber}
        threads={threads}
        activeId={activeId}
        onSelect={onSelect}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
        onRestore={onRestore}
        onDeleteForever={onDeleteForever}
      />
    </section>
  );
}

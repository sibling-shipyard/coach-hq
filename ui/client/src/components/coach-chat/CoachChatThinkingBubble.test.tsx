// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView - MessageList's own auto-scroll effect calls it on
// every render, unrelated to what this file is testing.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
import {
  ConversationPane,
  THINKING_STAGE_INTERVAL_MS,
  THINKING_STAGE_LABELS,
} from "./CoachChatWidgets";
import type { ChatThread } from "./coachChatModel";

// I1: the cycling "Coach is thinking…" label. Not tied to any real backend signal (that's
// #767) - just a fixed timer, so fake timers are enough to exercise every stage without an
// actual long-running request.
const thread: ChatThread = {
  id: "t1",
  dayOffset: 0,
  title: "Today",
  preview: "",
  ageLabel: "NOW",
  status: "active",
  messages: [],
};

function renderPending() {
  return render(
    <ConversationPane
      dayNumber={1}
      thread={thread}
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      pending
    />,
  );
}

describe("ThinkingBubble cycling stage labels", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts on the first stage and cycles through all three in order", () => {
    vi.useFakeTimers();
    renderPending();

    expect(screen.getByText(THINKING_STAGE_LABELS[0])).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(THINKING_STAGE_INTERVAL_MS);
    });
    expect(screen.getByText(THINKING_STAGE_LABELS[1])).toBeInTheDocument();
    expect(screen.queryByText(THINKING_STAGE_LABELS[0])).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(THINKING_STAGE_INTERVAL_MS);
    });
    expect(screen.getByText(THINKING_STAGE_LABELS[2])).toBeInTheDocument();
  });

  it("holds on the last stage instead of looping if the request runs long", () => {
    vi.useFakeTimers();
    renderPending();

    act(() => {
      vi.advanceTimersByTime(THINKING_STAGE_INTERVAL_MS * 10);
    });
    expect(screen.getByText(THINKING_STAGE_LABELS[2])).toBeInTheDocument();
  });

  it("remounts the label element on every stage change so its fade-in animation replays", () => {
    vi.useFakeTimers();
    renderPending();

    const first = screen.getByText(THINKING_STAGE_LABELS[0]);
    expect(first.getAttribute("data-stage-index")).toBe("0");

    act(() => {
      vi.advanceTimersByTime(THINKING_STAGE_INTERVAL_MS);
    });
    const second = screen.getByText(THINKING_STAGE_LABELS[1]);
    expect(second.getAttribute("data-stage-index")).toBe("1");
    // A different DOM node, not the same span with its text mutated in place - that's what
    // makes the CSS animation (which only runs on element insertion) fire again per stage.
    expect(second).not.toBe(first);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
import { ConversationPane } from "./CoachChatWidgets";
import type { ChatThread } from "./coachChatModel";

// Regression test for the focus-management gap flagged (and deferred) across #958-#965: opening
// this sheet swaps the whole pane's content in place of the sync-row list, so a keyboard/screen
// reader user needs focus carried into it on open and back to the triggering row on close.
const thread: ChatThread = {
  id: "t1",
  dayOffset: 0,
  title: "Today",
  preview: "",
  ageLabel: "NOW",
  status: "active",
  messages: [
    {
      id: "m1",
      role: "coach",
      paragraphs: [],
      attachments: [
        {
          version: 1,
          kind: "synced_activity_list",
          batch_id: "b1",
          activities: [
            { id: "a1", title: "Morning run", sport: "run", start: "", duration_s: 1800, load: 42 },
          ],
        },
      ],
    },
  ],
};

function renderPane() {
  return render(
    <ConversationPane
      dayNumber={1}
      thread={thread}
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
    />,
  );
}

describe("ActivityDetailSheet focus management", () => {
  afterEach(cleanup);

  it("moves focus into the sheet on open and back to the triggering row on close", () => {
    renderPane();
    const trigger = screen.getByText("Morning run").closest("button");
    expect(trigger).not.toBeNull();
    trigger?.focus();
    fireEvent.click(trigger!);

    const closeButton = screen.getByRole("button", { name: "Close activity detail" });
    expect(closeButton).toHaveFocus();

    fireEvent.click(closeButton);
    // The sheet closing remounts MessageList, so the row that reclaims focus is a fresh DOM
    // node with the same activity id, not the exact node `trigger` referenced pre-open.
    expect(screen.getByText("Morning run").closest("button")).toHaveFocus();
  });

  it("closes on Escape and returns focus to the triggering row", () => {
    renderPane();
    const trigger = screen.getByText("Morning run").closest("button");
    trigger?.focus();
    fireEvent.click(trigger!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Morning run").closest("button")).toHaveFocus();
  });

  it("returns focus to the triggering pane when desktop and mobile copies are mounted", () => {
    renderPane();
    renderPane();
    const triggers = screen.getAllByText("Morning run").map((title) => title.closest("button"));
    fireEvent.click(triggers[1]!);

    fireEvent.click(screen.getByRole("button", { name: "Close activity detail" }));

    expect(screen.getAllByText("Morning run")[1].closest("button")).toHaveFocus();
  });
});

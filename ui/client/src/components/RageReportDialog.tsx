/**
 * "Report a problem" — the athlete's own account of a failure that never threw.
 *
 * Sentry hears about the web only when code throws, and the common web failure is not a throw:
 * the coach answered badly, or the screen sat there. This is the one control that turns that
 * class of failure into an event (`submitRageReport`).
 *
 * Self-contained on purpose — its own open state, no context, no router, no toast. One of its two
 * hosts is `ErrorBoundary`'s fallback, which renders in a tree that has already crashed, with
 * `<Toaster />` and every provider unmounted above it. Anything it reached for there would be
 * gone, so it confirms the send in its own body instead.
 *
 * The panel is portalled to `document.body` so `.wi-shell`'s type and box-sizing rules never
 * reach it: one host is inside that shell and the other is nowhere near it.
 */
import { submitRageReport } from "@/lib/observability";
import { cn } from "@/lib/utils";
import { MessageSquareWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function RageReportDialog() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset on open rather than on close, so `send` can leave `sent` standing for the confirmation
  // and the next open still starts on an empty box.
  useEffect(() => {
    if (!open) return;
    setSent(false);
    setMessage("");
    textareaRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Cancel, Escape and the backdrop all land here, and none of them sends anything: the only
  // call to `submitRageReport` is in `send`.
  function close() {
    setOpen(false);
  }

  function send() {
    if (!submitRageReport(message)) return;
    setSent(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 px-3 py-2 rounded-lg",
          "text-sm text-muted-foreground",
          "hover:text-foreground cursor-pointer",
        )}
      >
        <MessageSquareWarning size={16} />
        Report a problem
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
              onClick={close}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Report a problem"
                // The backdrop closes on click, so the panel has to stop clicks reaching it.
                onClick={(event) => event.stopPropagation()}
                className="flex flex-col w-full max-w-lg p-6 rounded-xl bg-background shadow-xl"
              >
                {sent ? (
                  <>
                    <h2 className="text-lg mb-2">Report sent</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Thanks — we can see what you were doing when it went wrong.
                    </p>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={close}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg mb-2">What went wrong?</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Say it however you like. What you clicked just before is sent with it.
                    </p>
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      rows={5}
                      placeholder="The coach answered as if it had not read my last message."
                      className="w-full p-3 mb-6 rounded-lg border bg-muted text-sm resize-none"
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={close}
                        className="px-4 py-2 rounded-lg hover:bg-muted cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={send}
                        disabled={!message.trim()}
                        className={cn(
                          "px-4 py-2 rounded-lg bg-primary text-primary-foreground",
                          "hover:opacity-90 cursor-pointer",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        Send report
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

import { useState, type FormEvent } from "react";

interface WelcomeInviteCtaProps {
  betaLabel?: string;
}

type SubmitState = "idle" | "loading" | "sent" | "error";

export function WelcomeInviteCta({ betaLabel = "PRIVATE BETA" }: WelcomeInviteCtaProps) {
  const [email, setEmail] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/.+@.+\..+/.test(trimmed)) return;

    setSubmitState("loading");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source: "welcome" }),
      });

      if (res.status === 503) {
        setSubmitState("error");
        return;
      }

      if (!res.ok) {
        setSubmitState("error");
        return;
      }

      setSubmitState("sent");
    } catch {
      setSubmitState("error");
    }
  }

  const sent = submitState === "sent";
  const loading = submitState === "loading";
  const errored = submitState === "error";

  return (
    <section className="welcome-cta" id="invite">
      <div className="welcome-cta__inner">
        <span className="welcome-kicker welcome-kicker--center">{betaLabel} · BY INVITE</span>
        <h2 className="welcome-cta__title">Come train with a coach that remembers.</h2>
        <p className="welcome-cta__lede">
          I&apos;m handing this to a few friends first. If you want in, grab a spot and be one of the
          earliest testers.
        </p>

        <form className="welcome-cta__inline" onSubmit={(event) => void handleSubmit(event)}>
          <label className="sr-only" htmlFor="welcome-invite-email">
            Email address
          </label>
          <input
            id="welcome-invite-email"
            type="email"
            autoComplete="email"
            required
            disabled={loading}
            placeholder="you@email.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (submitState !== "idle") setSubmitState("idle");
            }}
            className="welcome-cta__input welcome-cta__input--inline"
          />
          <button
            type="submit"
            disabled={loading}
            className="welcome-cta__submit welcome-cta__submit--inline"
          >
            {sent ? "You're in ✓" : loading ? "Saving…" : "Request my invite"}
          </button>
        </form>

        <p
          className={`welcome-cta__note ${sent ? "is-success" : errored ? "is-error" : ""}`}
          role={sent || errored ? "status" : undefined}
        >
          {sent
            ? "SAVED. I'LL EMAIL YOU WHEN YOUR HQ IS READY."
            : errored
              ? "COULDN'T SAVE RIGHT NOW — TRY AGAIN IN A MOMENT."
              : "ONE EMAIL WHEN IT'S YOUR TURN. NOTHING ELSE."}
        </p>

        <p className="welcome-cta__footer">
          COACH PHELPS · PROCESS OVER OUTCOME · MADE FOR ATHLETES WHO ARE DONE FIGHTING THEMSELVES
        </p>
      </div>
    </section>
  );
}

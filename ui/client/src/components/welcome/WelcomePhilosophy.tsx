export function WelcomePhilosophy() {
  return (
    <section className="welcome-philosophy">
      <div className="welcome-philosophy__inner">
        <div data-reveal>
          <span className="welcome-philosophy__kicker">THE LONG HAUL</span>
          <h2 className="welcome-philosophy__title">
            The best in the world didn&apos;t get there chasing medals. They got there chasing the
            process.
          </h2>
          <p className="welcome-philosophy__lede">
            Showing up for the one rep, every day, no exceptions. That&apos;s what this is. Not a
            countdown. Not a program you finish. A coach who&apos;s in it with you for the long
            haul.
          </p>
        </div>
        <div className="welcome-philosophy__aside" data-reveal>
          <span>1% TODAY</span>
          <span>1% TOMORROW</span>
          <span className="welcome-philosophy__aside-muted">
            THAT&apos;S HOW IT&apos;S
            <br />
            ALWAYS BEEN DONE
          </span>
        </div>
      </div>
    </section>
  );
}

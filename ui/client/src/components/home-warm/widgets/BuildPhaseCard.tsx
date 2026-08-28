import type { BuildPhaseSnapshot } from "../snapshots";

export function BuildPhaseCard({ phase }: { phase: BuildPhaseSnapshot }) {
  return (
    <section className="wi-build-card">
      <div className="wi-card-kicker">
        <span>
          <span className="wi-desktop-only">
            {phase.title ?? "BUILD PHASE · IF THE PLAN HOLDS"}
          </span>
          <span className="wi-mobile-only">BUILD PHASE</span>
        </span>
        <b>{phase.weekLabel}</b>
      </div>
      <div className="wi-build-card__rail">
        <div>
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <span>
            BLOCK 1<span className="wi-desktop-only"> · BUILD</span>
          </span>
          <span>DELOAD</span>
          <span>
            BLOCK 2<span className="wi-desktop-only"> · BUILD</span>
          </span>
          <span>TEST</span>
        </div>
      </div>
      <div className="wi-build-card__milestones">
        {phase.milestones.slice(0, 3).map((milestone) => {
          const key = milestone.id ?? milestone.name;
          const current = milestone.current ?? milestone.baseline;
          const hasProgress = milestone.progressPercent != null;
          return (
            <div className="wi-build-card__milestone" key={key}>
              <strong>{milestone.name}</strong>
              <span>
                {current} → <b>{milestone.target}</b>
              </span>
              {hasProgress ? (
                <div
                  className="wi-build-card__progress"
                  role="progressbar"
                  aria-valuenow={milestone.progressPercent!}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${milestone.name} progress`}
                >
                  <span style={{ width: `${milestone.progressPercent}%` }} />
                </div>
              ) : null}
              <aside aria-hidden="true" className="wi-build-card__badge">
                <span>{milestone.name.toUpperCase()}</span>
                <strong>
                  {current} → {milestone.target}
                </strong>
                {hasProgress ? <strong>{milestone.progressPercent}% THERE</strong> : null}
                {milestone.projectedDateLabel ? (
                  <strong>ETA · {milestone.projectedDateLabel}</strong>
                ) : null}
                <small>
                  BASELINE {milestone.baseline}
                  {milestone.note ? ` · ${milestone.note}` : ""}
                </small>
              </aside>
            </div>
          );
        })}
      </div>
      <p>{phase.read}</p>
    </section>
  );
}

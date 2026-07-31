import { useEffect, useRef } from "react";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Pop-in stagger for heatmap cells, etc. */
const POP_DURATION_MS = 750;
const POP_STAGGER_MS = 140;

/** Curtain-flutter cascade for session rows on welcome page */
const FLUTTER_STAGGER_MS = 180;

export function useWelcomeAnimations(enabled = true) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !rootRef.current) return;
    const reduced = prefersReducedMotion();

    const revealEls = rootRef.current.querySelectorAll<HTMLElement>("[data-reveal]");
    revealEls.forEach((el) => {
      if (reduced) {
        el.style.opacity = "1";
        el.style.transform = "none";
        return;
      }
      el.style.opacity = "0";
      el.style.transform = "translateY(26px)";
      el.style.transition =
        "opacity 0.8s cubic-bezier(0.2, 0.6, 0.2, 1), transform 0.8s cubic-bezier(0.2, 0.6, 0.2, 1)";
    });

    const growEls = rootRef.current.querySelectorAll<HTMLElement>("[data-grow]");
    growEls.forEach((el) => {
      if (reduced) {
        el.style.width = el.dataset.grow ?? "100%";
        return;
      }
      el.style.width = "0";
      el.style.transition = el.style.transition || "width 1s cubic-bezier(0.2, 0.7, 0.2, 1)";
    });

    const countEls = rootRef.current.querySelectorAll<HTMLElement>("[data-count-to]");
    countEls.forEach((el) => {
      if (reduced) {
        const to = parseFloat(el.dataset.countTo ?? "0");
        const suffix = el.dataset.suffix ?? "";
        el.textContent = `${Math.round(to)}${suffix}`;
      }
    });

    const popEls = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-pop]"));
    const popGroups = new Map<Element, HTMLElement[]>();
    popEls.forEach((el) => {
      const parent = el.parentElement;
      if (!parent) return;
      if (!popGroups.has(parent)) popGroups.set(parent, []);
      popGroups.get(parent)!.push(el);
    });
    if (!reduced) {
      popGroups.forEach((list) =>
        list.forEach((el, index) => {
          el.style.opacity = "0";
          el.style.transform = "translateY(10px) scale(0.94)";
          const delay = index * POP_STAGGER_MS;
          el.style.transition = `opacity ${POP_DURATION_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delay}ms, transform ${POP_DURATION_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delay}ms`;
        }),
      );
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.style.opacity = "1";
          target.style.transform = "none";
          revealObserver.unobserve(target);
        });
      },
      { threshold: 0.1 },
    );
    revealEls.forEach((el) => {
      if (!reduced) revealObserver.observe(el);
    });

    const growObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          requestAnimationFrame(() => {
            target.style.width = target.dataset.grow ?? "100%";
          });
          growObserver.unobserve(target);
        });
      },
      { threshold: 0.4 },
    );
    growEls.forEach((el) => {
      if (!reduced) growObserver.observe(el);
    });

    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          countObserver.unobserve(el);
          const to = parseFloat(el.dataset.countTo ?? "0");
          const suffix = el.dataset.suffix ?? "";
          const duration = 1100;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = `${Math.round(to * eased)}${suffix}`;
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.6 },
    );
    countEls.forEach((el) => {
      if (!reduced) countObserver.observe(el);
    });

    const popObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.style.opacity = "1";
          target.style.transform = "none";
          popObserver.unobserve(target);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -5% 0px" },
    );
    popEls.forEach((el) => {
      if (!reduced) popObserver.observe(el);
      else {
        el.style.opacity = "1";
        el.style.transform = "none";
      }
    });

    const flutterContainers = new Set<HTMLElement>();
    rootRef.current.querySelectorAll<HTMLElement>("[data-flutter]").forEach((el) => {
      const container = el.closest(".wi-sessions-card__rows");
      if (container instanceof HTMLElement) flutterContainers.add(container);
    });

    if (reduced) {
      flutterContainers.forEach((container) => {
        container.classList.add("is-fluttering");
        container.querySelectorAll<HTMLElement>("[data-flutter]").forEach((el) => {
          el.style.opacity = "1";
          el.style.transform = "none";
        });
      });
    }

    const flutterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const container = entry.target as HTMLElement;
          container.classList.add("is-fluttering");
          container.querySelectorAll<HTMLElement>("[data-flutter]").forEach((el, index) => {
            el.style.animationDelay = `${index * FLUTTER_STAGGER_MS}ms`;
          });
          flutterObserver.unobserve(container);
        });
      },
      { threshold: 0.4 },
    );
    flutterContainers.forEach((container) => {
      if (!reduced) flutterObserver.observe(container);
    });

    const failsafe = window.setTimeout(() => {
      revealEls.forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      flutterContainers.forEach((container) => {
        container.classList.add("is-fluttering");
        container.querySelectorAll<HTMLElement>("[data-flutter]").forEach((el) => {
          el.style.opacity = "1";
          el.style.transform = "none";
        });
      });
    }, 2500);

    return () => {
      window.clearTimeout(failsafe);
      revealObserver.disconnect();
      growObserver.disconnect();
      countObserver.disconnect();
      popObserver.disconnect();
      flutterObserver.disconnect();
    };
  }, [enabled]);

  return rootRef;
}

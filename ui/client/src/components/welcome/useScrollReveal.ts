import { useEffect, useRef } from "react";

export function useScrollReveal(enabled = true) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !rootRef.current) return;

    const elements = rootRef.current.querySelectorAll<HTMLElement>("[data-reveal]");
    elements.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(28px)";
      el.style.transition =
        "opacity 0.8s cubic-bezier(0.2, 0.6, 0.2, 1), transform 0.8s cubic-bezier(0.2, 0.6, 0.2, 1)";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target as HTMLElement;
          target.style.opacity = "1";
          target.style.transform = "none";
          observer.unobserve(target);
        });
      },
      { threshold: 0.12 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [enabled]);

  return rootRef;
}

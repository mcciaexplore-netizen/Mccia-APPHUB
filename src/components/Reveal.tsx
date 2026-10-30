"use client";

import { useEffect, useRef } from "react";

/**
 * A grid whose items fade in (and rise 8px) as they are scrolled into view, 50ms apart within each batch. Items already on screen when the
 * page opens are left alone: they come in with their own CSS animation, which needs no JavaScript, so nothing waits on this. Only items
 * that start below the fold are hidden (off screen, so nothing is seen to vanish) until they are scrolled to. Skipped entirely when the
 * person has asked for less motion.
 */
export function Reveal({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = ref.current;
    if (!grid || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver((entries) => {
      let n = 0;
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (!seen.has(el)) {
          // The first report says where it starts: on screen, it is already showing; below, it waits.
          seen.add(el);
          if (e.isIntersecting) { io.unobserve(el); continue; }
          el.classList.add("reveal-pending");
          continue;
        }
        if (!e.isIntersecting) continue;
        io.unobserve(el);
        el.style.setProperty("--reveal-delay", `${Math.min(n++, 5) * 50}ms`);
        el.classList.replace("reveal-pending", "reveal-in");
      }
    }, { rootMargin: "0px 0px -24px 0px" });
    const watch = () => { for (const el of Array.from(grid.children)) if (!seen.has(el)) io.observe(el); };
    watch();
    // Searching and filtering change the items: new ones are watched too.
    const mo = new MutationObserver(watch);
    mo.observe(grid, { childList: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

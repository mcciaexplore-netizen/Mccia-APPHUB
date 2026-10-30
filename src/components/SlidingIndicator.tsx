"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * The marker beside the sidebar line of the page open, which slides to the new line when another page is opened. The nav it is used in
 * must be `relative`; the marker is the 2px teal edge the lines already use. Until it has measured the line (and whenever the sidebar is
 * hidden, as in a closed phone menu), the line's own left border shows instead, so the marker is never missing. The first placement is
 * instant; only later moves slide. With less motion asked for, it moves at once (the global reduced-motion rule).
 */
export function useSlidingIndicator() {
  const navRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  const place = () => {
    const nav = navRef.current, bar = barRef.current;
    if (!nav || !bar) return;
    const line = nav.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!line || line.offsetHeight === 0) {
      delete nav.dataset.indicatorReady;
      bar.style.opacity = "0";
      placed.current = false;
      return;
    }
    if (!placed.current) bar.style.transition = "none";
    bar.style.transform = `translateY(${line.offsetTop}px)`;
    bar.style.height = `${line.offsetHeight}px`;
    bar.style.opacity = "1";
    if (!placed.current) {
      void bar.offsetHeight; // the jump above is applied before transitions come back
      bar.style.transition = "";
      placed.current = true;
    }
    nav.dataset.indicatorReady = "";
  };

  // After every render (a new page open, counts changing): cheap, one lookup.
  useLayoutEffect(place);
  // A phone menu opening, or the window resizing, moves the lines without a render here.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  const indicator = <span ref={barRef} aria-hidden className="nav-indicator pointer-events-none absolute left-0 top-0 w-[2px] bg-[#2a6b7c] opacity-0" />;
  return { navRef, indicator };
}

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Never left running: a navigation that has not finished by then (or was cancelled) hides the bar anyway. */
const GIVE_UP_MS = 8000;

/**
 * A thin teal bar along the top while a page is on its way, like GitHub's. It starts the moment a link to another page of the hub is clicked
 * (not a new tab, a download, a file or a link to the same page), creeps forward while waiting, and fills and fades out once the address
 * has changed. With less motion asked for it simply appears and disappears.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = useRef(false);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (trickle.current) clearInterval(trickle.current);
    trickle.current = null;
  };
  const finish = () => {
    if (!running.current) return;
    running.current = false;
    clear();
    setWidth(100);
    timers.current.push(setTimeout(() => setVisible(false), 200), setTimeout(() => setWidth(0), 400));
  };

  // Started by a click on a link to another page of the hub.
  useEffect(() => {
    // Listened to before the link's own handler (Next's Link cancels the browser's navigation to do its own), so nothing has been decided yet.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || to.pathname.startsWith("/api/")) return;
      if (to.pathname === location.pathname && to.search === location.search) return; // the same page, or a #part of it
      clear();
      running.current = true;
      setVisible(true);
      setWidth(20);
      // Creeps towards 90% while the page is on its way, slower the further it gets.
      trickle.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.15 : w)), 250);
      timers.current.push(setTimeout(finish, GIVE_UP_MS));
    };
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The address has changed: the new page is here.
  useEffect(() => { finish(); }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-[2px]">
      <div
        className="h-full bg-[var(--c-primary)] shadow-[0_0_6px_rgba(42,107,124,0.5)]"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0, transition: `width 0.2s ease-out, opacity 0.2s ease-out` }}
      />
    </div>
  );
}

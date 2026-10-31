"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 700;

/** Counts from 0 to `value` once, when it first scrolls into view. Later changes (live refresh) show immediately. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [p, setP] = useState(0); // eased progress, 0 to 1

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setP(1);
          return;
        }
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / DURATION_MS, 1);
          setP(1 - Math.pow(1 - t, 3));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const shown = p >= 1 ? value : Math.round(value * p);
  return (
    <span ref={ref} aria-label={value.toLocaleString("en-IN")}>
      {shown.toLocaleString("en-IN")}
    </span>
  );
}

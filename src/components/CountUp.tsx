"use client";

import { useEffect, useRef, useState } from "react";

/** Counts up once when scrolled into view: 1.8s, cubic ease-out, en-IN formatting. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current!;
    let raf = 0, done = false;
    const io = new IntersectionObserver((entries) => {
      if (done || !entries[0].isIntersecting) return;
      done = true; io.disconnect();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1800);
        setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.1 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref} className={className}>{n.toLocaleString("en-IN")}</span>;
}

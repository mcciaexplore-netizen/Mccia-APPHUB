"use client";

import { useEffect, useRef } from "react";

const CELL = 45;
const SPEED = 0.4;
const TRAIL = 6;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Drifting grid with hover trail; sits behind content. Static when reduced motion is on. */
export function AnimatedGrid() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const line = cssVar("--grid-line");
    const fill = cssVar("--grid-fill");
    let w = 0, h = 0, off = 0, raf = 0;
    let trail: { x: number; y: number }[] = [];

    const resize = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left + off) / CELL);
      const y = Math.floor((e.clientY - r.top + off) / CELL);
      const last = trail[trail.length - 1];
      if (!last || last.x !== x || last.y !== y) trail = [...trail, { x, y }].slice(-TRAIL);
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      const o = off % CELL;
      ctx.beginPath();
      for (let x = -o; x < w; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = -o; y < h; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.fillStyle = fill;
      trail.forEach((c, i) => {
        ctx.globalAlpha = (i + 1) / trail.length;
        ctx.fillRect(c.x * CELL - off, c.y * CELL - off, CELL, CELL);
      });
      ctx.globalAlpha = 1;
      if (!reduce) { off += SPEED; raf = requestAnimationFrame(draw); }
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    if (!reduce) window.addEventListener("mousemove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,var(--c-blue-tint-border),transparent_70%)] blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,var(--c-green-tint-border),transparent_70%)] blur-3xl" />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

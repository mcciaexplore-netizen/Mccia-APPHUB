"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { OrgNode } from "@/lib/attendance/people";
import { ORG_H as H, ORG_ROOT as ROOT, ORG_W as W, layout } from "@/lib/attendance/org-layout";

/** The org chart: drag to pan, wheel or pinch to zoom, buttons to zoom and fit. */
export function OrgChart({ nodes, me }: { nodes: OrgNode[]; me: string }) {
  const { placed, width, height } = useMemo(() => layout(nodes), [nodes]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ x: number; y: number; k: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const fit = () => {
    const el = box.current;
    if (!el) return { x: 20, y: 20, k: 1 };
    const k = Math.min(1, (el.clientWidth - 40) / width, (el.clientHeight - 40) / height);
    return { k, x: (el.clientWidth - width * k) / 2, y: 20 };
  };
  const v = view ?? { x: 20, y: 20, k: 1 };
  const touched = useRef(false);
  // Fit the chart to the box once it has a size (and again if the box resizes before anyone has moved it).
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (touched.current) return;
      const k = Math.min(1, (el.clientWidth - 40) / width, (el.clientHeight - 40) / height);
      setView({ k, x: (el.clientWidth - width * k) / 2, y: 20 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  const zoomAt = (factor: number, cx: number, cy: number) => {
    touched.current = true;
    const k = Math.min(2.5, Math.max(0.2, v.k * factor));
    setView({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
  };
  const centre = () => ({ cx: (box.current?.clientWidth ?? 0) / 2, cy: (box.current?.clientHeight ?? 0) / 2 });

  return (
    <div className="att-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--att-line)] px-4 py-2">
        <span className="text-xs att-muted">{nodes.length} people</span>
        <div className="flex gap-1">
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2, centre().cx, centre().cy)}>
            <Minus size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Zoom in" onClick={() => zoomAt(1.2, centre().cx, centre().cy)}>
            <Plus size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Fit to screen" onClick={() => setView(fit())}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div
        ref={box}
        className="att-org"
        onWheel={(e) => {
          const r = box.current!.getBoundingClientRect();
          zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          touched.current = true;
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId);
          if (!prev) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current) {
              const r = box.current!.getBoundingClientRect();
              zoomAt(d / pinch.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
            }
            pinch.current = d;
            return;
          }
          setView({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y });
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: "0 0", width, height }}>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
            {placed
              .filter((p) => p.parent)
              .map((p) => {
                const q = byId.get(p.parent!)!;
                const x1 = q.x + W / 2;
                const y1 = q.y + H;
                const x2 = p.x + W / 2;
                const y2 = p.y;
                const my = (y1 + y2) / 2;
                return <path key={p.id} d={`M${x1},${y1} V${my} H${x2} V${y2}`} fill="none" stroke="#cbd5e1" strokeWidth={1.5} />;
              })}
          </svg>
          {placed.map((p) => (
            <div key={p.id} className={`att-org-node ${p.id === ROOT ? "att-org-root" : ""} ${p.id === me ? "att-org-me" : ""}`} style={{ left: p.x, top: p.y, height: H }}>
              <p className="truncate font-bold">{p.name}</p>
              <p className={`truncate text-[0.7rem] ${p.id === ROOT ? "text-white/80" : "att-muted"}`}>{p.designation ?? ""}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

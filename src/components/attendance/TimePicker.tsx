"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { WHEEL_HOURS, hm12, joinHm, snapIndex, splitHm, wheelMinutes } from "@/lib/attendance/time-wheel";

/**
 * Attendance's time picker: two scroll wheels (hours 00–23, minutes in 5-minute steps), like a phone's clock. A wheel turns with a swipe,
 * the mouse wheel (one notch = one step), its ▲ ▼ arrows, a click on a number, or the keyboard (↑ ↓, Page Up/Down, Home/End), and
 * always settles on a number. Controlled (value + onChange) or, inside a form read with FormData, uncontrolled (name + defaultValue: a
 * hidden input carries "HH:MM").
 */

const ROW = 44; // px: one number's row, also the smallest touch target

export function TimePicker({
  label,
  value,
  defaultValue = "10:00",
  onChange,
  name,
  testId,
}: {
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  name?: string;
  testId?: string;
}) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const [h, m] = splitHm(current);
  const set = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <span id={labelId} className="text-xs font-semibold att-muted">
        {label}
      </span>
      <div className="att-wheel-box">
        <Wheel label={`${label}: hours`} values={WHEEL_HOURS} selected={h} onSelect={(x) => set(joinHm(x, m))} />
        <span className="att-wheel-colon" aria-hidden>
          :
        </span>
        <Wheel label={`${label}: minutes`} values={wheelMinutes(m)} selected={m} onSelect={(x) => set(joinHm(h, x))} />
      </div>
      <span className="att-wheel-caption" aria-hidden>
        <span>Hours</span>
        <span>Minutes</span>
      </span>
      <span className="text-center text-xs att-muted" data-testid={testId ? `${testId}-value` : undefined}>
        {hm12(current)}
      </span>
      {name && <input type="hidden" name={name} value={joinHm(h, m)} />}
    </div>
  );
}

function Wheel({ label, values, selected, onSelect }: { label: string; values: number[]; selected: number; onSelect: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = Math.max(0, values.indexOf(selected));
  const latest = useRef({ values, index, onSelect });
  useEffect(() => {
    latest.current = { values, index, onSelect };
  });

  // Keep the wheel on the chosen number (first draw, the arrows, the keyboard, a change from outside).
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ROW) > 1) el.scrollTo({ top: index * ROW, behavior: "auto" });
  }, [index]);

  // When a scroll (a swipe, a trackpad, the scroll bar) comes to rest, choose the number it rests on.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => {
      const { values: vs, index: was, onSelect: pick } = latest.current;
      const i = snapIndex(el.scrollTop, ROW, vs.length);
      if (i !== was) pick(vs[i]);
      else if (Math.abs(el.scrollTop - i * ROW) > 1) el.scrollTo({ top: i * ROW, behavior: "smooth" });
    };
    const onScroll = () => {
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(done, 140);
    };
    // A mouse wheel turns one step per notch (a trackpad's small movements add up to a step), instead of flinging past several numbers.
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (Math.abs(acc) < 30) return;
      const step = acc > 0 ? 1 : -1;
      acc = 0;
      const { values: vs, index: i, onSelect: pick } = latest.current;
      const next = Math.min(vs.length - 1, Math.max(0, i + step));
      if (next !== i) pick(vs[next]);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  const step = (by: number) => onSelect(values[Math.min(values.length - 1, Math.max(0, index + by))]);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="att-wheel">
      <button type="button" className="att-wheel-arrow" tabIndex={-1} aria-label={`${label}: earlier`} disabled={index === 0} onClick={() => step(-1)}>
        <ChevronUp size={18} />
      </button>
      <div className="att-wheel-window">
        <div className="att-wheel-band" aria-hidden />
        <div
          ref={ref}
          className="att-wheel-scroll"
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={values[0]}
          aria-valuemax={values[values.length - 1]}
          aria-valuenow={selected}
          aria-valuetext={pad(selected)}
          onKeyDown={(e) => {
            const by = { ArrowUp: -1, ArrowDown: 1, PageUp: -3, PageDown: 3, Home: -values.length, End: values.length }[e.key];
            if (by == null) return;
            e.preventDefault();
            step(by);
          }}
        >
          {values.map((v, i) => (
            <div key={v} className={`att-wheel-item${i === index ? " is-on" : ""}`} onClick={() => onSelect(v)} aria-hidden>
              {pad(v)}
            </div>
          ))}
        </div>
      </div>
      <button type="button" className="att-wheel-arrow" tabIndex={-1} aria-label={`${label}: later`} disabled={index === values.length - 1} onClick={() => step(1)}>
        <ChevronDown size={18} />
      </button>
    </div>
  );
}

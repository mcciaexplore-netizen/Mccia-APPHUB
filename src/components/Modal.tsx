"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** How long the closing animation runs (.backdrop-out and .dialog-out) before the dialog is gone. */
const OUT_MS = 200;

/**
 * A dialog over the page: the backdrop fades in and the box rises a little as it appears. Closed by the person (✕, the backdrop, Esc), it
 * plays the same in reverse and then calls onClose; with less motion asked for, it closes at once. When the page closes it itself (after
 * a save), it simply goes.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = useCallback(() => {
    if (closingRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onCloseRef.current();
    closingRef.current = true;
    setClosing(true);
    setTimeout(() => onCloseRef.current(), OUT_MS);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [close]);
  return (
    <div className={`fixed inset-0 z-[90] grid place-items-center bg-overlay p-4 ${closing ? "backdrop-out pointer-events-none" : "backdrop-in"}`} onMouseDown={close}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`glass max-h-[90vh] w-full max-w-2xl overflow-y-auto !bg-white/90 p-6 backdrop-blur-[16px] sm:p-8 ${closing ? "dialog-out" : "dialog-in"}`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl">{title}</h2>
          <button aria-label="Close" onClick={close}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

const OUT_MS = 220;

/**
 * A panel that slides up from the bottom of the screen (the comments, on screens narrower than 1280px). It takes the focus when it opens,
 * closes on Escape, on its close button or a tap on the dimmed page behind it, and slides back down first. With less motion asked for, it
 * appears and goes at once.
 */
export function BottomDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => onCloseRef.current(), still ? 0 : OUT_MS);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    // Mounted off-screen, then moved up on the next frame, so the move is animated.
    const frame = requestAnimationFrame(() => {
      setShown(true);
      panel.current?.focus();
    });
    const key = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <div className="eru-drawer-wrap" data-open={shown}>
      <div className="eru-drawer-backdrop" aria-hidden onClick={close} />
      <div ref={panel} className="eru-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-open={shown} data-testid="eru-drawer">
        <div className="eru-drawer-handle" aria-hidden />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[0.95rem] font-bold text-ink">{title}</h2>
          <button type="button" className="eru-tool" aria-label="Close" onClick={close}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>
      </div>
    </div>
  );
}

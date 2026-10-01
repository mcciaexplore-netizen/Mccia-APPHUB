"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-overlay p-4" onMouseDown={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass max-h-[90vh] w-full max-w-2xl animate-pop overflow-y-auto !bg-white/90 p-6 backdrop-blur-[16px] sm:p-8"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl">{title}</h2>
          <button aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

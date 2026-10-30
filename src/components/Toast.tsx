"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type T = { id: number; kind: "success" | "error"; msg: string; leaving?: boolean };
/** How long a toast takes to sink away (the .toast-out animation) before it is removed. */
const OUT_MS = 200;
const Ctx = createContext<(kind: T["kind"], msg: string) => void>(() => {});

export const useToast = () => {
  const push = useContext(Ctx);
  return {
    success: (m: string) => push("success", m),
    error: (m: string) => push("error", m),
  };
};

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  // Dismissed (or timed out): it sinks away first, then goes.
  const dismiss = useCallback((id: number) => {
    setItems((s) => s.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), OUT_MS);
  }, []);
  const push = useCallback((kind: T["kind"], msg: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, msg }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`alert ${t.leaving ? "toast-out" : "toast-in"} shadow-card-hover ${t.kind === "success" ? "alert-green" : "alert-red"} !bg-white`}>
            {t.kind === "success" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-1 text-ink">{t.msg}</span>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type T = { id: number; kind: "success" | "error"; msg: string };
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
  const push = useCallback((kind: T["kind"], msg: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, msg }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`alert animate-pop shadow-card-hover ${t.kind === "success" ? "alert-green" : "alert-red"} !bg-white`}>
            {t.kind === "success" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
            <span className="flex-1 text-ink">{t.msg}</span>
            <button aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

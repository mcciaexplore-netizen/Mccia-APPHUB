"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@/components/Modal";

type Opts = { title: string; message: string; confirmLabel?: string; danger?: boolean };
const Ctx = createContext<(o: Opts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Opts | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const confirm = useCallback((o: Opts) => new Promise<boolean>((res) => { resolver.current = res; setOpts(o); }), []);
  const done = (v: boolean) => { resolver.current(v); setOpts(null); };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      {opts && (
        <Modal title={opts.title} onClose={() => done(false)}>
          <p className="text-sm text-muted">{opts.message}</p>
          <div className="mt-6 flex justify-end gap-3">
            <button className="btn btn-ghost btn-sm" onClick={() => done(false)}>Cancel</button>
            <button className={`btn btn-sm ${opts.danger ? "btn-danger" : "btn-primary"}`} onClick={() => done(true)}>
              {opts.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

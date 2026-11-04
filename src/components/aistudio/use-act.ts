"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/Toast";
import type { ActionResult } from "@/lib/aistudio/dal";

/** Runs a server action from a page: shows its message or error, refreshes the page on success, and returns the result. */
export function useAct() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const act = <T,>(fn: () => Promise<ActionResult<T>>, opts: { quiet?: boolean } = {}) =>
    new Promise<ActionResult<T>>((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) toast.error(r.error);
        else {
          if (!opts.quiet && r.message) toast.success(r.message);
          router.refresh();
        }
        resolve(r);
      }),
    );
  return { act, pending };
}

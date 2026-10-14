import { useCallback, useEffect, useRef } from "react";

/** A function that waits `ms` after the last call before running (for search boxes). */
export function useDebouncedCallback(fn, ms) {
  const timer = useRef();
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(...args), ms);
  }, [ms]);
}

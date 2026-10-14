import { useEffect, useState } from "react";
import { getCounts } from "../services/submissionService.js";

const NONE = { pending: {}, info: 0 };

/** How many requests wait for this person, per module, and how many of theirs need more information. Reloads when `refreshKey` changes and every `everyMs`. */
export function useCounts(refreshKey, everyMs) {
  const [counts, setCounts] = useState(NONE);
  useEffect(() => {
    let live = true;
    const load = () => getCounts().then((c) => live && setCounts(c)).catch(() => {});
    load();
    const t = everyMs ? setInterval(load, everyMs) : null;
    return () => { live = false; if (t) clearInterval(t); };
  }, [refreshKey, everyMs]);
  return counts;
}

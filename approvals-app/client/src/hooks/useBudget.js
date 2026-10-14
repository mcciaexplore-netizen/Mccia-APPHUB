import { useEffect, useState } from "react";
import { lookupBudget } from "../services/budgetService.js";

/**
 * The budget for the chosen branch and category: { allocated, used, available }, or null until both are chosen and the answer arrives.
 * `exclude` is the request being edited, so it does not count against itself.
 */
export function useBudget(enabled, branch, category, exclude) {
  const key = enabled && branch && category ? `${branch}|${category}` : "";
  const [found, setFound] = useState(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    lookupBudget(branch, category, exclude).then((b) => live && setFound({ key, ...b })).catch(() => {});
    return () => { live = false; };
  }, [key, branch, category, exclude]);
  return { chosen: !!key, budget: found && found.key === key ? found : null };
}

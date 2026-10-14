import { useCallback, useEffect, useState } from "react";
import { getSubmission } from "../services/submissionService.js";

/** One request with everything about it. `reload` fetches it again (after a decision). */
export function useSubmission(id) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => getSubmission(id).then((d) => { setData(d); setError(""); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

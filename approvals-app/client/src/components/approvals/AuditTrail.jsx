import { fmtDateTime } from "../../utils/format.js";

/** Who did what to a request and when, oldest first, with the reason given. */
export default function AuditTrail({ audit }) {
  return (
    <>
      <h2 className="mb-3 text-base font-bold">Audit trail</h2>
      <ol className="max-w-2xl space-y-3 border-l-2 border-gray-200 pl-5">
        {audit.map((a, i) => (
          <li key={`${a.created_at}-${i}`}>
            <p className="font-bold">{a.action} <span className="font-normal text-gray-600">by {a.actor_name}</span></p>
            <p className="text-xs text-gray-500">{fmtDateTime(a.created_at)}</p>
            {a.comment && <p className="mt-1 whitespace-pre-wrap">&ldquo;{a.comment}&rdquo;</p>}
          </li>
        ))}
      </ol>
    </>
  );
}

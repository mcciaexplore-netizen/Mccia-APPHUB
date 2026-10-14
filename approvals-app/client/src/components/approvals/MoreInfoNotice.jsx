import { Link } from "react-router-dom";
import { ROUTES } from "../../constants/routes.js";

/** Shown to the person who raised a request when an approver asked for more information: the question and the way to answer it. */
export default function MoreInfoNotice({ submission }) {
  const asked = [...submission.audit].reverse().find((a) => a.action === "Requested more information");
  return (
    <div className="mb-6 max-w-2xl rounded border border-blue-300 bg-blue-50 p-4 text-blue-900">
      <p className="font-bold">More information was requested</p>
      {asked && <p className="mt-1 whitespace-pre-wrap">&ldquo;{asked.comment}&rdquo; ({asked.actor_name})</p>}
      <Link to={ROUTES.edit(submission.id)} className="btn btn-primary mt-3">Edit and resubmit</Link>
    </div>
  );
}

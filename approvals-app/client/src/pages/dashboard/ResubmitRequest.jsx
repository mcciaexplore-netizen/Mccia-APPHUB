import { useParams } from "react-router-dom";
import RequestForm from "../../components/forms/RequestForm.jsx";
import { useSubmission } from "../../hooks/useSubmission.js";

/** The form again, filled with what was sent, for answering an approver's "more information" request. */
export default function ResubmitRequest() {
  const { id } = useParams();
  const { data, error } = useSubmission(id);
  if (error) return <p className="text-red-600" role="alert">{error}</p>;
  if (!data) return <p className="text-gray-500">Loading…</p>;
  return <RequestForm key={id} moduleKey={data.module} detail={data} editId={id} />;
}

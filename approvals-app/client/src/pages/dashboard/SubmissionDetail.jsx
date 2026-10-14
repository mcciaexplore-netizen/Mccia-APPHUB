import { useState } from "react";
import { useParams } from "react-router-dom";
import AuditTrail from "../../components/approvals/AuditTrail.jsx";
import DecisionPanel from "../../components/approvals/DecisionPanel.jsx";
import MoreInfoNotice from "../../components/approvals/MoreInfoNotice.jsx";
import StageProgress from "../../components/approvals/StageProgress.jsx";
import SubmissionFields from "../../components/approvals/SubmissionFields.jsx";
import PageTitle from "../../components/common/PageTitle.jsx";
import StatusBadge from "../../components/common/StatusBadge.jsx";
import { useApp } from "../../context/AppContext.jsx";
import { useSubmission } from "../../hooks/useSubmission.js";
import { decideSubmission } from "../../services/submissionService.js";

const DONE = { approve: "Approved", reject: "Rejected", more_info: "More information requested" };

/** One request: its status, route, every field, the audit trail, and (for the approver it waits for) the decision panel. */
export default function SubmissionDetail() {
  const { id } = useParams();
  const { toast } = useApp();
  const { data: d, error, reload } = useSubmission(id);
  const [busy, setBusy] = useState(false);

  const decide = async (action, comment, clear) => {
    setBusy(true);
    try {
      await decideSubmission(id, action, comment);
      toast("ok", DONE[action]);
      clear();
    } catch (e) {
      toast("error", e.message);
    }
    await reload();
    setBusy(false);
  };

  if (error) return <p className="text-red-600" role="alert">{error}</p>;
  if (!d) return <p className="text-gray-500">Loading…</p>;

  return (
    <>
      <PageTitle title={`${d.ref_no}: ${d.module_label}`}><StatusBadge status={d.status} /></PageTitle>
      {d.can.resubmit && <MoreInfoNotice submission={d} />}
      {d.can.act && <DecisionPanel busy={busy} onDecide={decide} onInvalid={(m) => toast("error", m)} />}
      <StageProgress stages={d.stages} />
      <SubmissionFields submission={d} />
      <AuditTrail audit={d.audit} />
    </>
  );
}

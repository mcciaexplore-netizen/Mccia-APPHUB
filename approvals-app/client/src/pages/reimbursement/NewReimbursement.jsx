import RequestForm from "../../components/forms/RequestForm.jsx";

/** Reimbursement: the form is drawn from the server's definition of "reimbursement" (server/modules.js). */
export default function NewReimbursement() {
  return <RequestForm moduleKey="reimbursement" />;
}

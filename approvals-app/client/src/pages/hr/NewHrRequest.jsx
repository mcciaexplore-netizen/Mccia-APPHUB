import RequestForm from "../../components/forms/RequestForm.jsx";

/** DG Approval: HR: the form is drawn from the server's definition of "hr" (server/modules.js). */
export default function NewHrRequest() {
  return <RequestForm moduleKey="hr" />;
}

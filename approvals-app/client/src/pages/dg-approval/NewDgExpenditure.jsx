import RequestForm from "../../components/forms/RequestForm.jsx";

/** DG Approval: Expenditure (₹10,000 and above): the form is drawn from the server's definition of "dg_expenditure" (server/modules.js). */
export default function NewDgExpenditure() {
  return <RequestForm moduleKey="dg_expenditure" />;
}

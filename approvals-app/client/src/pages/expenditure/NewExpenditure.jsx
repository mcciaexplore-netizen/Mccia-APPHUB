import RequestForm from "../../components/forms/RequestForm.jsx";

/** Expenditure (below ₹10,000): the form is drawn from the server's definition of "expenditure" (server/modules.js). */
export default function NewExpenditure() {
  return <RequestForm moduleKey="expenditure" />;
}

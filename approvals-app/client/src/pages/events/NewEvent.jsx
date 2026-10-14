import RequestForm from "../../components/forms/RequestForm.jsx";

/** Events: the form is drawn from the server's definition of "event" (server/modules.js). */
export default function NewEvent() {
  return <RequestForm moduleKey="event" />;
}

import { permanentRedirect } from "next/navigation";

/** The old all-requests list. Requesters see only their own requests, which is My Requests; old links land there. */
export default function RequestsPage() {
  permanentRedirect("/design/my-requests");
}

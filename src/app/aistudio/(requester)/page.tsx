import { redirect } from "next/navigation";

/** The AI Studio tile opens here: the request form is the requester's home. */
export default function AiStudioHome() {
  redirect("/aistudio/request");
}

import { redirect } from "next/navigation";

/** Booking is the MCCIA Cabs home page now; this address (in older links and notifications) goes there. */
export default function BookRedirect() {
  redirect("/cabs");
}

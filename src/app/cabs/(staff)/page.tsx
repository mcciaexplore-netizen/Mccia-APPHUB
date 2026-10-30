import { BookingForm } from "@/components/cabs/BookingForm";
import { RideAlertsBanner } from "@/components/cabs/RideAlerts";
import { requireCabsPage } from "@/lib/cabs/guard";

/** Book: a greeting with the person's full name (as the hub has it), "Where to?", then the request form. */
export default async function BookPage() {
  const user = await requireCabsPage();
  return (
    <div className="page-enter max-w-xl space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted">Hi {user.name}</p>
        <h1 className="mt-1 text-3xl font-extrabold text-ink">Where to?</h1>
        <p className="mt-1 text-sm text-muted">Send a cab request for MCCIA approval.</p>
      </div>
      <BookingForm />
      <RideAlertsBanner />
    </div>
  );
}

import { BookingForm } from "@/components/cabs/BookingForm";
import { requireCabsPage } from "@/lib/cabs/guard";

export const metadata = { title: "Book a Ride · MCCIA Cabs · MCCIA App Hub" };

export default async function BookPage() {
  const user = await requireCabsPage();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Book a Ride</h1><p className="text-sm text-muted">Say where from, where to and when. You’ll be told once a driver and car are assigned.</p></div>
      <BookingForm branchName={user.branchName} />
    </div>
  );
}

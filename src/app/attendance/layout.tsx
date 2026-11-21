import { notFound } from "next/navigation";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { attEnabled } from "@/lib/attendance/flags";
import "./attendance.css";

export const dynamic = "force-dynamic";

/**
 * Attendance is two sections, each with its own layout: (staff) at /attendance (check in/out, leave, time, more) and admin/ (Attendance
 * Admin, for HR). This wrapper answers 404 for both while the module is switched off (ATT_ENABLED) and loads the module's styles (att-).
 */
export default function AttendanceRootLayout({ children }: { children: React.ReactNode }) {
  if (!attEnabled()) notFound();
  return <ConfirmProvider>{children}</ConfirmProvider>;
}

/**
 * Attendance is OFF unless ATT_ENABLED=true. Off, every /attendance page and /api/attendance route answers 404 (and the reminder cron does
 * nothing), so this code can be deployed before its tables exist (scripts/apply-0044-attendance.sql) and switched on once they do. The hub
 * tiles appear only once the two applications (/attendance, /attendance/admin) are added in Administrator → Applications.
 */
export const attEnabled = () => process.env.ATT_ENABLED === "true";

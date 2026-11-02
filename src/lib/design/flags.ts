/**
 * DesignDesk is OFF unless DESIGN_ENABLED=true. Off, every /design page, the review and tracking links and every /api/design route answer
 * 404 (and the scheduled jobs do nothing), so this code can be deployed before its tables exist (scripts/apply-0037-design.sql) and
 * switched on once they do. The hub tiles appear only once the two applications (/design, /design/admin) are added in Administrator →
 * Applications.
 */
export const designEnabled = () => process.env.DESIGN_ENABLED === "true";

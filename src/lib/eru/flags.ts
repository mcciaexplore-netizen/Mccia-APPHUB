/**
 * ERU is OFF unless ERU_ENABLED=true. Off, every /eru page and /api/eru route answers 404 (and the background clean-up does nothing), so this
 * code can be deployed before its tables exist (scripts/apply-0039-eru.sql) and switched on once they do. The hub tiles appear only once the
 * two applications (/eru, /eru/admin) are added in Administrator → Applications.
 */
export const eruEnabled = () => process.env.ERU_ENABLED === "true";

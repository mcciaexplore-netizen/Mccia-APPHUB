/**
 * IVR-CRM is OFF unless IVR_ENABLED=true. Off, every /ivr page and /api/ivr route answers 404 (and the Smartflo webhook and the sync cron
 * do nothing), so this code can be deployed before its tables exist (scripts/apply-0036-ivr.sql) and switched on once they do. The hub
 * tiles appear only once the two applications (/ivr, /ivr/admin) are added in Administrator → Applications.
 */
export const ivrEnabled = () => process.env.IVR_ENABLED === "true";

/**
 * AI Studio is OFF unless AISTUDIO_ENABLED=true. Off, every /aistudio page and /api/aistudio route answers 404 (and the background jobs do
 * nothing), so this code can be deployed before its tables exist (scripts/apply-0038-aistudio.sql) and switched on once they do. The hub
 * tiles appear only once the two applications (/aistudio, /aistudio/admin) are added in Administrator → Applications.
 */
export const aistudioEnabled = () => process.env.AISTUDIO_ENABLED === "true";

/**
 * Cab Booking is OFF unless CABS_ENABLED=true. Off, every /cabs page and /api/cabs route answers 404, so this code can be deployed before
 * its tables exist (scripts/apply-0028-cabs.sql) and switched on once they do. The hub tiles appear only once the three applications
 * (/cabs, /cabs/driver, /cabs/admin) are added in Administrator → Applications.
 */
export const cabsEnabled = () => process.env.CABS_ENABLED === "true";

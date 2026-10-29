/** A refusal with a message that is safe to show the person, and the HTTP status it answers with. */
export class InventoryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

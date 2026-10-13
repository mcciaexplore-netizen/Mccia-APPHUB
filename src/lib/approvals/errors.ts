/** An expected, user-facing failure: the message is safe to show. Anything else is logged and shown generically. */
export class ApprovalsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

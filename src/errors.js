export class UserError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "UserError";
    this.details = details;
  }
}


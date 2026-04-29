export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function assertOrThrow(condition, status, message) {
  if (!condition) {
    throw new AppError(status, message);
  }
}


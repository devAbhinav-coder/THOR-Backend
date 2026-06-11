class AppError extends Error {
  public statusCode: number;
  public status: string;
  public isOperational: boolean;
  /** Seconds until the client may retry (rate limits, resend cooldown). */
  public retryAfter?: number;

  constructor(message: string, statusCode: number, retryAfter?: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    if (retryAfter != null && retryAfter > 0) {
      this.retryAfter = Math.ceil(retryAfter);
    }

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;

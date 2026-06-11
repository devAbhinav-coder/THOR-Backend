import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import * as Sentry from "@sentry/node";
import AppError from "../types/utils/AppError";
import logger from "../types/utils/logger";

interface MongoError extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
  path?: string;
  value?: unknown;
  errors?: Record<string, { message: string }>;
}

const handleCastErrorDB = (err: MongoError): AppError => {
  return new AppError(`Invalid ${err.path}: ${err.value}`, 400);
};

const handleDuplicateFieldsDB = (
  err: MongoError,
  isProd: boolean,
): AppError => {
  if (isProd) {
    return new AppError(
      "This value is already in use. Please use another.",
      400,
    );
  }
  const field = Object.keys(err.keyValue || {})[0];
  const value = err.keyValue?.[field];
  return new AppError(
    `Duplicate field value: "${value}" for field "${field}". Please use another value.`,
    400,
  );
};

const handleValidationErrorDB = (err: MongoError): AppError => {
  const errors = Object.values(err.errors || {}).map((el) => el.message);
  return new AppError(`Invalid input data. ${errors.join(". ")}`, 400);
};

const handleJWTError = (): AppError =>
  new AppError("Invalid token. Please log in again.", 401);

const handleJWTExpiredError = (): AppError =>
  new AppError("Your token has expired. Please log in again.", 401);

function operationalErrorJson(err: AppError): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: err.status,
    message: err.message,
  };
  if (err.retryAfter != null && err.retryAfter > 0) {
    body.retryAfter = err.retryAfter;
  }
  return body;
}

const sendErrorDev = (err: AppError, res: Response): void => {
  res.status(err.statusCode).json({
    ...operationalErrorJson(err),
    error: err,
    stack: err.stack,
  });
};

const sendErrorProd = (err: AppError, res: Response): void => {
  if (err.isOperational) {
    res.status(err.statusCode).json(operationalErrorJson(err));
  } else {
    logger.error("UNEXPECTED ERROR:", err);
    if (process.env.SENTRY_DSN?.trim()) {
      Sentry.captureException(err);
    }
    res.status(500).json({
      status: "error",
      message: "Something went wrong. Please try again later.",
    });
  }
};

const errorHandler = (
  err: Error & Partial<AppError> & MongoError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const error = err as AppError & MongoError;
  error.statusCode = error.statusCode || 500;
  error.status = error.status || "error";

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(error, res);
  } else {
    let processedError = { ...error, message: error.message } as AppError &
      MongoError;

    if (error instanceof mongoose.Error.CastError) {
      processedError = handleCastErrorDB(error) as AppError & MongoError;
    }
    if (error.code === 11000) {
      processedError = handleDuplicateFieldsDB(error, true) as AppError &
        MongoError;
    }
    if (error instanceof mongoose.Error.ValidationError) {
      processedError = handleValidationErrorDB(error) as AppError & MongoError;
    }
    if (error.name === "JsonWebTokenError") {
      processedError = handleJWTError() as AppError & MongoError;
    }
    if (error.name === "TokenExpiredError") {
      processedError = handleJWTExpiredError() as AppError & MongoError;
    }

    sendErrorProd(processedError, res);
  }
};

export default errorHandler;

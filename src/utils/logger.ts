import winston from "winston";
import { getRequestContext } from "./requestContext";

const isProd = process.env.NODE_ENV === "production";

const injectContext = winston.format((info) => {
  const ctx = getRequestContext();
  if (ctx?.requestId) {
    info.requestId = ctx.requestId;
  }
  if (ctx?.ip) {
    info.ip = ctx.ip;
  }
  return info;
});

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  injectContext(),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp: ts, stack, ...rest }) => {
    const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    return `${ts} [${level}]: ${stack || message}${meta}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  injectContext(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: isProd ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

export default logger;

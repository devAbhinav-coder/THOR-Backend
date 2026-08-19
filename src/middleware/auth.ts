import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest, JwtPayload } from "../types";

function readAccessToken(req: AuthRequest): string | undefined {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    return req.headers.authorization.split(" ")[1];
  }
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken as string;
  }
  return undefined;
}

export const protect = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return next(
        new AppError(
          "You are not logged in. Please log in to get access.",
          401,
        ),
      );
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
      algorithms: ["HS256"],
    }) as JwtPayload;

    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return next(
        new AppError("The user belonging to this token no longer exists.", 401),
      );
    }

    if (!currentUser.isActive) {
      return next(
        new AppError(
          "Your account has been deactivated. Please contact support.",
          401,
        ),
      );
    }

    if (currentUser.changedPasswordAfter(decoded.iat)) {
      return next(
        new AppError(
          "User recently changed password. Please log in again.",
          401,
        ),
      );
    }

    req.user = currentUser;
    next();
  },
);

/** Sets req.user when a valid token is present; never fails the request. */
export const optionalProtect = catchAsync(
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    let token: string | undefined;
    if (req.headers.authorization?.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken as string;
    }
    if (!token || token === "loggedout") {
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
        algorithms: ["HS256"],
      }) as JwtPayload;
      const currentUser = await User.findById(decoded.id);
      if (currentUser?.isActive) {
        req.user = currentUser;
      }
    } catch {
      /* public route — ignore invalid token */
    }
    next();
  },
);

export const restrictTo = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError("You do not have permission to perform this action.", 403),
      );
    }
    next();
  };
};

/** Admin with 2FA enabled must have `a2f` claim on the access token. */
export const requireAdminTwoFactor = catchAsync(
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== "admin") return next();
    if (!req.user.adminTwoFactorEnabled) return next();

    const token = readAccessToken(req);
    if (!token || token === "loggedout") {
      return next(
        new AppError("Admin two-factor verification required.", 403),
      );
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
        algorithms: ["HS256"],
      }) as JwtPayload;
      if (!decoded.a2f) {
        return next(
          new AppError("Admin two-factor verification required.", 403),
        );
      }
    } catch {
      return next(
        new AppError("Admin two-factor verification required.", 403),
      );
    }

    next();
  },
);

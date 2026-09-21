import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import AppError from "../types/utils/AppError";
import catchAsync from "../types/utils/catchAsync";
import { AuthRequest, JwtPayload, IUser } from "../types";
import {
  adminAreaForApiPath,
  adminAreaForExternalAdminApi,
  isAdminPanelUser,
  userHasAdminArea,
  type ExternalAdminApiKind,
} from "../constants/adminAccess";
import { isAccessSessionRevoked } from "../services/auth/authAccessRevokeService";
import {
  getAuthUserSnapshot,
  type AuthUserSnapshot,
} from "../services/auth/authUserSnapshotService";

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

function hydrateUserFromSnapshot(snapshot: AuthUserSnapshot): IUser {
  return User.hydrate({
    ...snapshot,
    _id: snapshot._id,
    passwordChangedAt:
      snapshot.passwordChangedAt ?
        new Date(snapshot.passwordChangedAt)
      : undefined,
    createdAt: snapshot.createdAt ? new Date(snapshot.createdAt) : undefined,
    updatedAt: snapshot.updatedAt ? new Date(snapshot.updatedAt) : undefined,
  }) as IUser;
}

function passwordChangedAfterIat(
  snapshot: AuthUserSnapshot,
  iat: number,
): boolean {
  if (!snapshot.passwordChangedAt) return false;
  const changedTs = Math.floor(
    new Date(snapshot.passwordChangedAt).getTime() / 1000,
  );
  return iat < changedTs;
}

async function resolveAuthenticatedUser(
  decoded: JwtPayload,
): Promise<IUser | null> {
  if (decoded.sid && (await isAccessSessionRevoked(decoded.sid))) {
    return null;
  }

  const snapshot = await getAuthUserSnapshot(decoded.id);
  if (!snapshot || !snapshot.isActive) {
    return null;
  }

  if (typeof decoded.ver === "number" && decoded.ver !== snapshot.tokenEpoch) {
    return null;
  }

  if (passwordChangedAfterIat(snapshot, decoded.iat)) {
    return null;
  }

  return hydrateUserFromSnapshot(snapshot);
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

    if (!token || token === "loggedout") {
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

    const currentUser = await resolveAuthenticatedUser(decoded);
    if (!currentUser) {
      return next(
        new AppError(
          "Your session is invalid or has expired. Please log in again.",
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
      const currentUser = await resolveAuthenticatedUser(decoded);
      if (currentUser) {
        req.user = currentUser;
      }
    } catch {
      /* public route - ignore invalid token */
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

/** Full admin or staff with at least one admin area granted. */
export const restrictToAdminPanel = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user || !isAdminPanelUser(req.user)) {
    return next(
      new AppError("You do not have permission to perform this action.", 403),
    );
  }
  next();
};

/** After panel auth - staff limited by area; full admin passes. */
export const requireAdminApiAccess = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void => {
  const user = req.user;
  if (!user) {
    return next(
      new AppError("You do not have permission to perform this action.", 403),
    );
  }
  if (user.role === "admin") return next();

  const area = adminAreaForApiPath(req.path);
  if (area === "admin_only" || area === null) {
    return next(
      new AppError("You do not have permission to perform this action.", 403),
    );
  }
  if (!userHasAdminArea(user, area)) {
    return next(
      new AppError("You do not have permission to perform this action.", 403),
    );
  }
  next();
};

export const requireExternalAdminApiAccess = (kind: ExternalAdminApiKind) => {
  const area = adminAreaForExternalAdminApi(kind);
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user || !isAdminPanelUser(user)) {
      return next(
        new AppError("You do not have permission to perform this action.", 403),
      );
    }
    if (user.role === "admin") return next();
    if (!userHasAdminArea(user, area)) {
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
      return next(new AppError("Admin two-factor verification required.", 403));
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
      return next(new AppError("Admin two-factor verification required.", 403));
    }

    next();
  },
);

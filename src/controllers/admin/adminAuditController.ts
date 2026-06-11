import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import AdminAuditLog from "../../models/AdminAuditLog";
import AppError from "../../types/utils/AppError";
import catchAsync from "../../types/utils/catchAsync";
import { sendPaginated } from "../../types/utils/response";

export const getAdminAuditLogs = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) || "20", 10)),
    );
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    const action = String(req.query.action || "").trim();
    const ip = String(req.query.ip || "").trim();
    const userId = String(req.query.userId || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    if (action) filter.action = action;
    if (ip)
      filter.ip = {
        $regex: ip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };

    if (userId) {
      if (!Types.ObjectId.isValid(userId))
        return next(new AppError("Invalid user id filter.", 400));
      filter.$or = [{ actor: userId }, { targetUser: userId }];
    }

    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime()))
          return next(new AppError("Invalid from date.", 400));
        createdAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (Number.isNaN(d.getTime()))
          return next(new AppError("Invalid to date.", 400));
        createdAt.$lte = d;
      }
      filter.createdAt = createdAt;
    }

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .sort("-createdAt")
        .skip(skip)
        .limit(limit)
        .populate("actor", "name email role")
        .populate("targetUser", "name email role"),
      AdminAuditLog.countDocuments(filter),
    ]);

    sendPaginated(res, { logs }, { page, limit, total });
  },
);

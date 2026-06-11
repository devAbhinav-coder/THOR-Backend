import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import User from "../../models/User";
import Order from "../../models/Order";
import OfflineCustomer from "../../models/OfflineCustomer";
import AppError from "../../types/utils/AppError";
import catchAsync from "../../types/utils/catchAsync";
import { sendPaginated, sendSuccess } from "../../types/utils/response";
import { writeAdminAudit } from "../../services/adminAuditService";
import { AuthRequest } from "../../types";

// ─── Directory ────────────────────────────────────────────────────────────────

export const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = parseInt((req.query.limit as string) || "20", 10);
  const skip = (page - 1) * limit;
  const roleQuery = String(req.query.role || "user")
    .trim()
    .toLowerCase();

  const filter: Record<string, unknown> =
    roleQuery === "admin" ? { role: "admin" }
    : roleQuery === "all" ? {}
    : { role: "user" };

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort("-createdAt")
      .skip(skip)
      .limit(limit)
      .select("name email phone avatar role isActive createdAt"),
    User.countDocuments(filter),
  ]);

  sendPaginated(res, { users }, { page, limit, total });
});

/** Accurate active / inactive counts via a single aggregation (avoids 6 countDocuments). */
export const getUserDirectoryStats = catchAsync(
  async (_req: Request, res: Response) => {
    const [stats] = await User.aggregate<{
      totalUsers: number;
      activeUsers: number;
      inactiveUsers: number;
      totalAdmins: number;
      activeAdmins: number;
      inactiveAdmins: number;
    }>([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: { $cond: [{ $eq: ["$role", "user"] }, 1, 0] } },
          activeUsers: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$role", "user"] }, "$isActive"] },
                1,
                0,
              ],
            },
          },
          inactiveUsers: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$role", "user"] }, { $not: "$isActive" }] },
                1,
                0,
              ],
            },
          },
          totalAdmins: { $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } },
          activeAdmins: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$role", "admin"] }, "$isActive"] },
                1,
                0,
              ],
            },
          },
          inactiveAdmins: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$role", "admin"] }, { $not: "$isActive" }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    sendSuccess(res, {
      users: {
        total: stats?.totalUsers ?? 0,
        active: stats?.activeUsers ?? 0,
        inactive: stats?.inactiveUsers ?? 0,
      },
      admins: {
        total: stats?.totalAdmins ?? 0,
        active: stats?.activeAdmins ?? 0,
        inactive: stats?.inactiveAdmins ?? 0,
      },
    });
  },
);

/** POS / offline-sale leads. */
export const getOfflineCustomers = catchAsync(
  async (req: Request, res: Response) => {
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) || "20", 10)),
    );
    const skip = (page - 1) * limit;

    const [offlineCustomers, total] = await Promise.all([
      OfflineCustomer.find({})
        .sort({ lastOfflineOrderAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "email phone name lastOfflineOrderAt offlineOrderCount createdAt updatedAt",
        )
        .lean(),
      OfflineCustomer.countDocuments({}),
    ]);

    sendPaginated(res, { offlineCustomers }, { page, limit, total });
  },
);

// ─── Status / Role / Note ─────────────────────────────────────────────────────

export const toggleUserStatus = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id))
      return next(new AppError("Invalid user id.", 400));
    const actor = req.user;
    if (!actor) return next(new AppError("Not authenticated.", 401));
    if (String(actor._id) === req.params.id)
      return next(
        new AppError("You cannot change your own account status here.", 403),
      );

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError("User not found.", 404));

    user.isActive = !user.isActive;
    await user.save();
    await writeAdminAudit(
      req,
      "user.status.toggled",
      { isActive: user.isActive },
      String(user._id),
    );

    sendSuccess(res, { isActive: user.isActive });
  },
);

export const updateUserRole = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { role } = req.body as { role?: "user" | "admin" };
    if (!Types.ObjectId.isValid(req.params.id))
      return next(new AppError("Invalid user id.", 400));
    if (!role) return next(new AppError("Role is required.", 400));

    const actor = (req as Request & { user?: { _id?: unknown; role?: string } })
      .user;
    if (!actor || actor.role !== "admin")
      return next(new AppError("Only admins can change roles.", 403));
    if (String(actor._id) === req.params.id)
      return next(new AppError("You cannot change your own role.", 403));

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError("User not found.", 404));
    if (user.role === role)
      return next(new AppError(`User is already ${role}.`, 400));

    const previousRole = user.role;
    user.role = role;
    await user.save();
    await writeAdminAudit(
      req,
      "user.role.updated",
      { previousRole, newRole: role },
      String(user._id),
    );

    sendSuccess(
      res,
      { user: { _id: String(user._id), role: user.role } },
      "User role updated.",
    );
  },
);

export const updateUserNote = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id))
      return next(new AppError("Invalid user id.", 400));
    const note = String(req.body?.note || "").trim();

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError("User not found.", 404));

    user.adminNote = note.slice(0, 1000);
    await user.save();
    await writeAdminAudit(
      req,
      "user.note.updated",
      { noteLength: user.adminNote.length },
      String(user._id),
    );

    sendSuccess(
      res,
      { user: { _id: user._id, adminNote: user.adminNote } },
      "User note updated.",
    );
  },
);

// ─── Insights ─────────────────────────────────────────────────────────────────

export const getUserInsights = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!Types.ObjectId.isValid(req.params.id))
      return next(new AppError("Invalid user id.", 400));

    const user = await User.findById(req.params.id).select(
      "name email phone avatar role isActive createdAt adminNote",
    );
    if (!user) return next(new AppError("User not found.", 404));

    // Use aggregation for accurate lifetime metrics — never limit to 20 orders
    const [metricsAgg, recentOrders] = await Promise.all([
      Order.aggregate<{
        orderCount: number;
        paidOrderCount: number;
        totalSpent: number;
        lastOrderAt: Date | null;
      }>([
        { $match: { user: user._id } },
        {
          $group: {
            _id: null,
            orderCount: { $sum: 1 },
            paidOrderCount: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
            },
            totalSpent: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "paid"] },
                  { $toDouble: "$total" },
                  0,
                ],
              },
            },
            lastOrderAt: { $max: "$createdAt" },
          },
        },
      ]),
      Order.find({ user: user._id })
        .sort("-createdAt")
        .limit(10)
        .select("orderNumber status paymentStatus total createdAt items"),
    ]);

    const m = metricsAgg[0] ?? {
      orderCount: 0,
      paidOrderCount: 0,
      totalSpent: 0,
      lastOrderAt: null,
    };
    const avgOrderValue =
      m.paidOrderCount > 0 ? m.totalSpent / m.paidOrderCount : 0;
    const userSegment =
      m.paidOrderCount >= 5 || m.totalSpent >= 20000 ? "frequent_buyer"
      : m.paidOrderCount >= 2 ? "repeat_buyer"
      : m.paidOrderCount >= 1 ? "new_buyer"
      : "prospect";

    sendSuccess(res, {
      user,
      metrics: {
        orderCount: m.orderCount,
        paidOrderCount: m.paidOrderCount,
        totalSpent: m.totalSpent,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        lastOrderAt: m.lastOrderAt ?? null,
        userSegment,
      },
      orders: recentOrders,
    });
  },
);

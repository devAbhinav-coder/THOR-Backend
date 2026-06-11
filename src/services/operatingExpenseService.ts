import { Types } from "mongoose";
import OperatingExpense, {
  OPERATING_EXPENSE_CATEGORIES,
  type OperatingExpenseCategory,
} from "../models/OperatingExpense";
import AppError from "../types/utils/AppError";
import { roundMoney, sumMoney } from "../types/utils/financialMath";
import { writeAdminAudit } from "./adminAuditService";
import { AuthRequest } from "../types";
import { INVENTORY_QUERY_MAX_MS } from "../constants/inventoryQuery";

const CATEGORY_LABELS: Record<OperatingExpenseCategory, string> = {
  shipping_outbound: "Shipping (outbound)",
  packing: "Packing & handling",
  ads: "Ads & marketing",
  miscellaneous: "Miscellaneous",
  rent: "Rent / shop",
  utilities: "Utilities",
  salaries: "Salaries & labour",
  other: "Other",
};

export function getOperatingExpenseCategoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat as OperatingExpenseCategory] ?? cat;
}

export { CATEGORY_LABELS, OPERATING_EXPENSE_CATEGORIES };

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listOperatingExpenses(params: {
  page: number;
  limit: number;
  category?: string;
  from?: string;
  to?: string;
  search?: string;
}) {
  const skip = (params.page - 1) * params.limit;
  const filter: Record<string, unknown> = { status: { $ne: "voided" } };

  if (
    params.category &&
    OPERATING_EXPENSE_CATEGORIES.includes(
      params.category as OperatingExpenseCategory,
    )
  ) {
    filter.category = params.category;
  }
  if (params.from || params.to) {
    const dateFilter: Record<string, Date> = {};
    if (params.from) dateFilter.$gte = new Date(params.from);
    if (params.to) dateFilter.$lte = new Date(params.to);
    filter.expenseDate = dateFilter;
  }
  if (params.search?.trim()) {
    const s = escapeRegex(params.search.trim());
    filter.$or = [
      { title: { $regex: s, $options: "i" } },
      { notes: { $regex: s, $options: "i" } },
    ];
  }

  const [expenses, total] = await Promise.all([
    OperatingExpense.find(filter)
      .sort("-expenseDate")
      .skip(skip)
      .limit(params.limit)
      .populate("createdBy", "name email")
      .lean()
      .maxTimeMS(INVENTORY_QUERY_MAX_MS),
    OperatingExpense.countDocuments(filter).maxTimeMS(INVENTORY_QUERY_MAX_MS),
  ]);

  return { expenses, total };
}

export async function getOperatingExpenseSummary(params: { year?: number }) {
  const year = params.year ?? new Date().getFullYear();
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year + 1, 0, 1);
  const match = {
    status: { $ne: "voided" },
    expenseDate: { $gte: startDate, $lt: endDate },
  };

  const [byCategory, monthly, recentTotal] = await Promise.all([
    OperatingExpense.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS }),
    OperatingExpense.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $year: "$expenseDate" },
            month: { $month: "$expenseDate" },
            category: "$category",
          },
          total: { $sum: "$amount" },
        },
      },
    ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS }),
    OperatingExpense.aggregate([
      { $match: { status: { $ne: "voided" } } },
      {
        $group: {
          _id: null,
          grandTotal: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS }),
  ]);

  const yearTotal = sumMoney(
    (byCategory as { total: number }[]).map((r) => r.total),
  );
  const allTimeGrand = roundMoney(
    (recentTotal[0] as { grandTotal?: number })?.grandTotal ?? 0,
  );

  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [mtdAgg] = await OperatingExpense.aggregate([
    {
      $match: {
        status: { $ne: "voided" },
        expenseDate: { $gte: mtdStart, $lte: now },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]).option({ maxTimeMS: INVENTORY_QUERY_MAX_MS });
  const monthToDateTotal = roundMoney(
    (mtdAgg as { total?: number })?.total ?? 0,
  );

  const heatmapCells = (
    monthly as {
      _id: { year: number; month: number; category: string };
      total: number;
    }[]
  ).map((r) => ({
    year: r._id.year,
    month: r._id.month,
    category: r._id.category,
    total: roundMoney(r.total),
  }));

  const maxCell = Math.max(...heatmapCells.map((c) => c.total), 1);

  return {
    year,
    yearTotal: roundMoney(yearTotal),
    monthToDateTotal,
    allTimeTotal: allTimeGrand,
    expenseCount: (recentTotal[0] as { count?: number })?.count ?? 0,
    byCategory: (
      byCategory as { _id: string; total: number; count: number }[]
    ).map((r) => ({
      category: r._id,
      label: getOperatingExpenseCategoryLabel(r._id),
      total: roundMoney(r.total),
      count: r.count,
    })),
    heatmap: heatmapCells,
    maxHeatmapValue: maxCell,
    categoryLabels: CATEGORY_LABELS,
  };
}

export async function createOperatingExpense(
  req: AuthRequest,
  body: {
    category: OperatingExpenseCategory;
    title: string;
    amount: number;
    expenseDate: string;
    notes?: string;
  },
) {
  const expense = await OperatingExpense.create({
    category: body.category,
    title: body.title.trim(),
    amount: roundMoney(body.amount),
    expenseDate: new Date(body.expenseDate),
    notes: body.notes?.trim(),
    createdBy: req.user?._id,
    status: "active",
  });

  await writeAdminAudit(req, "operating_expense.created", {
    expenseId: String(expense._id),
    category: expense.category,
    amount: expense.amount,
  });

  return expense;
}

export async function updateOperatingExpense(
  req: AuthRequest,
  id: string,
  body: Partial<{
    category: OperatingExpenseCategory;
    title: string;
    amount: number;
    expenseDate: string;
    notes: string;
  }>,
) {
  if (!Types.ObjectId.isValid(id))
    throw new AppError("Expense not found.", 404);
  const expense = await OperatingExpense.findOne({
    _id: id,
    status: { $ne: "voided" },
  });
  if (!expense) throw new AppError("Expense not found.", 404);

  if (body.category) expense.category = body.category;
  if (body.title) expense.title = body.title.trim();
  if (body.amount !== undefined) expense.amount = roundMoney(body.amount);
  if (body.expenseDate) expense.expenseDate = new Date(body.expenseDate);
  if (body.notes !== undefined) expense.notes = body.notes.trim();

  await expense.save();
  await writeAdminAudit(req, "operating_expense.updated", { expenseId: id });
  return expense;
}

export async function voidOperatingExpense(
  req: AuthRequest,
  id: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(id))
    throw new AppError("Expense not found.", 404);
  const expense = await OperatingExpense.findOne({
    _id: id,
    status: { $ne: "voided" },
  });
  if (!expense) throw new AppError("Expense not found.", 404);

  expense.status = "voided";
  expense.voidedAt = new Date();
  expense.voidedBy = req.user?._id;
  await expense.save();

  await writeAdminAudit(req, "operating_expense.voided", {
    expenseId: id,
    amount: expense.amount,
    category: expense.category,
  });
}

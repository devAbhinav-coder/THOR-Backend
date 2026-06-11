import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import { sendPaginated, sendSuccess } from "../types/utils/response";
import { AuthRequest } from "../types";
import {
  createOperatingExpense,
  getOperatingExpenseSummary,
  listOperatingExpenses,
  updateOperatingExpense,
  voidOperatingExpense,
} from "../services/operatingExpenseService";

export const listOperatingExpensesHandler = catchAsync(
  async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit || "30"), 10)),
    );

    const { expenses, total } = await listOperatingExpenses({
      page,
      limit,
      category: String(req.query.category || "").trim() || undefined,
      from: String(req.query.from || "").trim() || undefined,
      to: String(req.query.to || "").trim() || undefined,
      search: String(req.query.search || "").trim() || undefined,
    });

    sendPaginated(res, { expenses }, { page, limit, total });
  },
);

export const getOperatingExpenseSummaryHandler = catchAsync(
  async (req: Request, res: Response) => {
    const year =
      req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    const summary = await getOperatingExpenseSummary({ year });
    sendSuccess(res, { summary });
  },
);

export const createOperatingExpenseHandler = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const expense = await createOperatingExpense(req, req.body);
    sendSuccess(res, { expense }, "Operating expense recorded.", 201);
  },
);

export const updateOperatingExpenseHandler = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const expense = await updateOperatingExpense(req, req.params.id, req.body);
    sendSuccess(res, { expense }, "Expense updated.");
  },
);

export const voidOperatingExpenseHandler = catchAsync(
  async (req: AuthRequest, res: Response) => {
    await voidOperatingExpense(req, req.params.id);
    sendSuccess(res, null, "Expense voided.");
  },
);

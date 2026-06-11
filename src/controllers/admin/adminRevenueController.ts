import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import {
  getRevenuePeriodSummary,
  type RevenuePeriod,
} from "../../services/revenuePeriodService";

const VALID_PERIODS: RevenuePeriod[] = ["month", "year", "lifetime"];

export const getRevenuePeriodSummaryHandler = catchAsync(
  async (req: Request, res: Response) => {
    const rawPeriod = String(req.query.period ?? "year");
    const period: RevenuePeriod =
      VALID_PERIODS.includes(rawPeriod as RevenuePeriod) ?
        (rawPeriod as RevenuePeriod)
      : "year";

    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;

    const data = await getRevenuePeriodSummary(period, {
      year: Number.isFinite(year) ? year : undefined,
      month:
        Number.isFinite(month) && month! >= 1 && month! <= 12 ?
          month
        : undefined,
    });

    sendSuccess(res, data);
  },
);

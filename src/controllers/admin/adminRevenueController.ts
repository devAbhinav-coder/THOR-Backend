import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import {
  getRevenuePeriodSummary,
  type RevenuePeriod,
} from "../../services/revenuePeriodService";
import type { OrderSalesChannelFilter } from "../../utils/orderChannel";

const VALID_PERIODS: RevenuePeriod[] = ["month", "year", "lifetime"];
const VALID_CHANNELS: OrderSalesChannelFilter[] = ["all", "online", "offline", "b2b"];

export const getRevenuePeriodSummaryHandler = catchAsync(
  async (req: Request, res: Response) => {
    const rawPeriod = String(req.query.period ?? "year");
    const period: RevenuePeriod =
      VALID_PERIODS.includes(rawPeriod as RevenuePeriod) ?
        (rawPeriod as RevenuePeriod)
      : "year";

    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const rawChannel = String(req.query.channel ?? "all");
    const channel: OrderSalesChannelFilter =
      VALID_CHANNELS.includes(rawChannel as OrderSalesChannelFilter) ?
        (rawChannel as OrderSalesChannelFilter)
      : "all";

    const data = await getRevenuePeriodSummary(period, {
      year: Number.isFinite(year) ? year : undefined,
      month:
        Number.isFinite(month) && month! >= 1 && month! <= 12 ?
          month
        : undefined,
      channel,
    });

    sendSuccess(res, data);
  },
);

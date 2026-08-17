import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import { getAllJobHealth } from "../../jobs/jobHealthService";

export const getAdminJobHealth = catchAsync(
  async (_req: Request, res: Response) => {
    const jobs = await getAllJobHealth();
    sendSuccess(res, {
      jobCount: Object.keys(jobs).length,
      jobs,
      timestamp: new Date().toISOString(),
    });
  },
);

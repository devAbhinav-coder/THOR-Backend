import { Request, Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import { getAllJobHealth } from "../../jobs/jobHealthService";
import { buildInfrastructureReport } from "../../config/infrastructureReadiness";

export const getAdminJobHealth = catchAsync(
  async (_req: Request, res: Response) => {
    const [jobs, infrastructure] = await Promise.all([
      getAllJobHealth(),
      buildInfrastructureReport(),
    ]);
    sendSuccess(res, {
      jobCount: Object.keys(jobs).length,
      jobs,
      infrastructure,
      timestamp: new Date().toISOString(),
    });
  },
);

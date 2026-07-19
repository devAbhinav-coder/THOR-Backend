import { Response } from "express";
import { AuthRequest } from "../types";
import catchAsync from "../types/utils/catchAsync";
import { sendBrowserMetaEvent } from "../services/metaCapiService";

export const recordBrowserMetaEvent = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { eventName, eventId, eventSourceUrl, customData, fbp, fbc } =
      req.body;

    await sendBrowserMetaEvent(
      eventName,
      eventId,
      eventSourceUrl,
      customData,
      {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        fbp,
        fbc,
      },
    );

    res.status(202).json({ status: "success" });
  },
);

import { Response } from "express";
import { AuthRequest } from "../types";
import catchAsync from "../types/utils/catchAsync";
import { sendBrowserMetaEvent } from "../services/metaCapiService";
import { resolveClientIp } from "../utils/metaUserData";

export const recordBrowserMetaEvent = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const {
      eventName,
      eventId,
      eventSourceUrl,
      customData,
      fbp,
      fbc,
      email,
      phone,
      externalId,
      firstName,
      lastName,
      city,
      state,
      zip,
      country,
    } = req.body;

    const userAgent = req.headers["user-agent"];
    const resolvedUserId =
      externalId ||
      (req.user?._id ? String(req.user._id) : undefined);

    await sendBrowserMetaEvent(
      eventName,
      eventId,
      eventSourceUrl,
      customData,
      {
        ip: resolveClientIp(req),
        userAgent: typeof userAgent === "string" ? userAgent : undefined,
        fbp,
        fbc,
        user: {
          email: email || req.user?.email,
          phone: phone || req.user?.phone,
          externalId: resolvedUserId,
          firstName,
          lastName,
          city,
          state,
          zip,
          country,
        },
      },
    );

    res.status(202).json({ status: "success" });
  },
);

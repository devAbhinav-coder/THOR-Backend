import { Response } from "express";
import catchAsync from "../../types/utils/catchAsync";
import { sendSuccess } from "../../types/utils/response";
import { AuthRequest } from "../../types";
import {
  disableAdminTwoFactor,
  enableAdminTwoFactor,
  generateTotpSetup,
  totpQrDataUrl,
} from "../../services/adminTwoFactorService";
import { writeAdminAudit } from "../../services/adminAuditService";

export const getAdminTwoFactorStatus = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const enabled = Boolean(req.user?.adminTwoFactorEnabled);
    sendSuccess(res, {
      enabled,
      required: process.env.ADMIN_2FA_REQUIRED === "true",
    });
  },
);

export const setupAdminTwoFactor = catchAsync(
  async (req: AuthRequest, res: Response) => {
    if (req.user?.adminTwoFactorEnabled) {
      return sendSuccess(res, { alreadyEnabled: true });
    }
    const { secret, otpauthUrl } = generateTotpSetup(req.user!.email);
    const qrDataUrl = await totpQrDataUrl(otpauthUrl);
    sendSuccess(res, {
      secret,
      otpauthUrl,
      qrDataUrl,
    });
  },
);

export const enableAdminTwoFactorHandler = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { secret, code } = req.body as { secret: string; code: string };
    const { backupCodes } = await enableAdminTwoFactor(
      String(req.user!._id),
      secret,
      code,
    );
    await writeAdminAudit(
      req,
      "security.admin_2fa.enabled",
      {},
      String(req.user!._id),
      String(req.user!._id),
    );
    sendSuccess(res, {
      enabled: true,
      backupCodes,
    });
  },
);

export const disableAdminTwoFactorHandler = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const { password, code } = req.body as { password: string; code: string };
    await disableAdminTwoFactor(String(req.user!._id), password, code);
    await writeAdminAudit(
      req,
      "security.admin_2fa.disabled",
      {},
      String(req.user!._id),
      String(req.user!._id),
    );
    sendSuccess(res, { enabled: false });
  },
);

import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../types/utils/response';
import { writeAdminAudit } from '../services/adminAuditService';
import { saleAdminService } from '../services/sale/saleAdminService';

export const createSaleCampaign = catchAsync(async (_req: Request, res: Response) => {
  const req = _req as AuthRequest & {
    uploadedSaleImage?: { url: string; publicId: string };
  };
  const body = { ...(req.body as Record<string, unknown>) };
  if (req.uploadedSaleImage) {
    body.imageUrl = req.uploadedSaleImage.url;
    body.imagePublicId = req.uploadedSaleImage.publicId;
  }
  if (!body.imageUrl || body.imageUrl === '') {
    delete body.imageUrl;
    delete body.imagePublicId;
  }
  const campaign = await saleAdminService.create(body);
  await writeAdminAudit(req, 'sale.create', {
    saleId: String(campaign._id),
    name: campaign.name,
  });
  sendSuccess(res, { campaign }, 'Sale campaign created', 201);
});

export const getAllSaleCampaigns = catchAsync(async (req: Request, res: Response) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await saleAdminService.list({ page, limit });
  sendSuccess(res, result);
});

export const getPublicSaleCampaigns = catchAsync(async (_req: Request, res: Response) => {
  const campaigns = await saleAdminService.listPublicStorefront();
  sendSuccess(res, { campaigns });
});

export const getSaleCampaign = catchAsync(async (req: Request, res: Response) => {
  const campaign = await saleAdminService.getById(req.params.id);
  sendSuccess(res, { campaign });
});

export const updateSaleCampaign = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest & {
    uploadedSaleImage?: { url: string; publicId: string };
  };
  const body = { ...(reqAuth.body as Record<string, unknown>) };
  if (reqAuth.uploadedSaleImage) {
    body.imageUrl = reqAuth.uploadedSaleImage.url;
    body.imagePublicId = reqAuth.uploadedSaleImage.publicId;
  }
  if (body.clearImage === true || body.clearImage === 'true') {
    body.imageUrl = '';
    body.imagePublicId = '';
  }
  const campaign = await saleAdminService.update(req.params.id, body);
  await writeAdminAudit(reqAuth, 'sale.update', { saleId: req.params.id });
  sendSuccess(res, { campaign }, 'Sale campaign updated');
});

export const deleteSaleCampaign = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  await saleAdminService.softDelete(req.params.id);
  await writeAdminAudit(reqAuth, 'sale.delete', { saleId: req.params.id });
  res.status(204).end();
});

export const archiveSaleCampaign = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  const campaign = await saleAdminService.archive(req.params.id);
  await writeAdminAudit(reqAuth, 'sale.archive', {
    saleId: req.params.id,
    name: campaign.name,
  });
  sendSuccess(res, { campaign }, 'Sale campaign archived');
});

export const previewSaleCampaign = catchAsync(async (req: Request, res: Response) => {
  const result = await saleAdminService.previewAffectedCount(req.body);
  sendSuccess(res, result);
});

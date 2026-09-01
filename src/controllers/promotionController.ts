import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import { AuthRequest } from '../types';
import { sendSuccess } from '../types/utils/response';
import { writeAdminAudit } from '../services/adminAuditService';
import { promotionAdminService } from '../services/promotion/promotionAdminService';
import { getPublicPromotions } from '../services/promotion/promotionCacheService';
import { promotionDisplayLabel } from '../services/promotion/promotionBusinessRules';

function attachUploadedImage(req: Request, body: Record<string, unknown>) {
  const reqAuth = req as AuthRequest & {
    uploadedPromotionImage?: { url: string; publicId: string };
  };
  if (reqAuth.uploadedPromotionImage) {
    body.imageUrl = reqAuth.uploadedPromotionImage.url;
    body.imagePublicId = reqAuth.uploadedPromotionImage.publicId;
  }
  if (!body.imageUrl || body.imageUrl === '') {
    delete body.imageUrl;
    delete body.imagePublicId;
  }
  if (body.clearImage === true || body.clearImage === 'true') {
    body.imageUrl = '';
    body.imagePublicId = '';
  }
  return body;
}

export const createPromotion = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  const body = attachUploadedImage(req, { ...(req.body as Record<string, unknown>) });
  const promotion = await promotionAdminService.create(body);
  await writeAdminAudit(reqAuth, 'promotion.create', {
    promotionId: String(promotion._id),
    name: promotion.name,
  });
  const { notifyWhatsAppCatalogAlert } = await import(
    '../services/whatsappNotifyService'
  );
  notifyWhatsAppCatalogAlert({
    kind: 'promotion',
    title: String(promotion.name || 'New offer'),
    path: '/shop',
  });
  sendSuccess(res, { promotion }, 'Promotion created', 201);
});

export const getAllPromotions = catchAsync(async (req: Request, res: Response) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await promotionAdminService.list({ page, limit });
  sendSuccess(res, result);
});

export const getPublicPromotionsHandler = catchAsync(async (_req: Request, res: Response) => {
  const promotions = await getPublicPromotions();
  const dtos = promotions.map((p) => ({
    _id: String(p._id),
    name: p.name,
    displayTitle: p.displayTitle?.trim() || p.name,
    description: p.description,
    termsAndConditions: p.termsAndConditions,
    badgeText: p.badgeText || null,
    imageUrl: p.imageUrl || null,
    promotionType: p.promotionType,
    buyQuantity: p.buyQuantity ?? 1,
    getQuantity: p.getQuantity ?? 1,
    getDiscountPercent: p.getDiscountPercent ?? 100,
    discountValue: p.discountValue ?? null,
    maxDiscountAmount: p.maxDiscountAmount ?? null,
    minOrderAmount: p.minOrderAmount ?? 0,
    scopeType: p.scopeType || 'all',
    categoryIds: (p.categoryIds || []).map(String),
    subcategoryIds: (p.subcategoryIds || []).map(String),
    productIds: (p.productIds || []).map(String),
    label: promotionDisplayLabel(p),
    startDate: p.startDate,
    endDate: p.endDate,
  }));
  sendSuccess(res, { promotions: dtos });
});

export const getPromotion = catchAsync(async (req: Request, res: Response) => {
  const promotion = await promotionAdminService.getById(req.params.id);
  sendSuccess(res, { promotion });
});

export const updatePromotion = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  const body = attachUploadedImage(req, { ...(req.body as Record<string, unknown>) });
  const promotion = await promotionAdminService.update(req.params.id, body);
  await writeAdminAudit(reqAuth, 'promotion.update', { promotionId: req.params.id });
  sendSuccess(res, { promotion }, 'Promotion updated');
});

export const deletePromotion = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  await promotionAdminService.softDelete(req.params.id);
  await writeAdminAudit(reqAuth, 'promotion.delete', { promotionId: req.params.id });
  res.status(204).end();
});

export const archivePromotion = catchAsync(async (req: Request, res: Response) => {
  const reqAuth = req as AuthRequest;
  const promotion = await promotionAdminService.archive(req.params.id);
  await writeAdminAudit(reqAuth, 'promotion.archive', {
    promotionId: req.params.id,
    name: promotion.name,
  });
  sendSuccess(res, { promotion }, 'Promotion archived');
});

export const previewPromotion = catchAsync(async (req: Request, res: Response) => {
  const result = await promotionAdminService.previewAffectedCount(req.body);
  sendSuccess(res, result);
});

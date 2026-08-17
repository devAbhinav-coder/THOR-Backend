import { Request, Response } from 'express';
import catchAsync from '../types/utils/catchAsync';
import { sendSuccess } from '../types/utils/response';
import { recordOfferInteractionEvent } from '../services/offerEventService';

export const recordOfferEvent = catchAsync(async (req: Request, res: Response) => {
  const { eventType, offerKind, offerId, offerLabel, sessionKey, path } = req.body as {
    eventType: 'popup_impression' | 'popup_dismiss' | 'popup_cta_click' | 'coupon_copy';
    offerKind: 'coupon' | 'sale' | 'promotion';
    offerId?: string;
    offerLabel?: string;
    sessionKey: string;
    path?: string;
  };

  const result = await recordOfferInteractionEvent({
    eventType,
    offerKind,
    offerId,
    offerLabel,
    sessionKey,
    path,
  });

  sendSuccess(res, result);
});

import OfferInteractionEvent from '../models/OfferInteractionEvent';
import { istDateString } from './storeVisitService';
import type { OfferInteractionEventType, OfferInteractionKind } from '../models/OfferInteractionEvent';

export async function recordOfferInteractionEvent(input: {
  eventType: OfferInteractionEventType;
  offerKind: OfferInteractionKind;
  offerId?: string;
  offerLabel?: string;
  sessionKey: string;
  path?: string;
}): Promise<{ recorded: boolean }> {
  const visitDate = istDateString();
  try {
    await OfferInteractionEvent.create({
      eventType: input.eventType,
      offerKind: input.offerKind,
      offerId: input.offerId,
      offerLabel: input.offerLabel,
      sessionKey: input.sessionKey,
      visitDate,
      path: input.path,
    });
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

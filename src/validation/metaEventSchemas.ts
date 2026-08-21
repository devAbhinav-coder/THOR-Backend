import { z } from "zod";

const browserId = z.string().trim().min(1).max(255).optional();

const userDataField = z.string().trim().min(1).max(200).optional();

const contentSchema = z.object({
  id: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().int().min(1).max(100),
  item_price: z.coerce.number().min(0).optional(),
});

export const browserMetaEventSchema = z.object({
  body: z.object({
    eventName: z.enum([
      "PageView",
      "ViewContent",
      "Search",
      "AddToCart",
      "InitiateCheckout",
      "AddToWishlist",
      "AddPaymentInfo",
      "CompleteRegistration",
      "Contact",
    ]),
    eventId: z.string().trim().min(8).max(200),
    eventSourceUrl: z.string().url().max(2048),
    fbp: browserId,
    fbc: browserId,
    email: userDataField,
    phone: userDataField,
    externalId: userDataField,
    firstName: userDataField,
    lastName: userDataField,
    city: userDataField,
    state: userDataField,
    zip: userDataField,
    country: userDataField,
    customData: z
      .object({
        currency: z.string().trim().length(3).optional(),
        value: z.coerce.number().min(0).optional(),
        content_name: z.string().trim().max(300).optional(),
        content_ids: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        content_type: z.enum(["product", "product_group"]).optional(),
        search_string: z.string().trim().max(300).optional(),
        num_items: z.coerce.number().int().min(0).max(1000).optional(),
        status: z.string().trim().max(50).optional(),
        contents: z.array(contentSchema).max(100).optional(),
      })
      .default({}),
  }),
});

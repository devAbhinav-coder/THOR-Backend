/** Curated FAQ + policy facts for Rani Care customer chat (no hallucination). */
export const SUPPORT_CONTACT = {
  phone: "8340311033",
  email: "support@thehouseofrani.com",
  brand: "The House of Rani",
} as const;

export const SUPPORT_FAQ_ENTRIES = [
  {
    id: "choose_saree",
    q: "How do I choose the right saree online?",
    a: "Use shop filters for fabric, price, and rating. Check product images, details, and reviews before ordering.",
  },
  {
    id: "bridal",
    q: "Do you offer bridal and occasion collections?",
    a: "Yes — we curate premium sarees and occasion styles, including bridal-ready options for weddings and festive events.",
  },
  {
    id: "gifting",
    q: "Can I place a custom gifting request?",
    a: "Yes. Visit the Gifting section to submit customization details. Some products use a quote/request flow before finalization.",
  },
  {
    id: "processing",
    q: "How long does order processing take?",
    a: "Orders are typically processed within 1–3 business days after payment confirmation. Peak seasons may take longer.",
  },
  {
    id: "delivery_time",
    q: "What are delivery timelines across India?",
    a: "After dispatch, delivery usually takes 3–10 business days depending on pin code and courier. Remote areas may take longer.",
  },
  {
    id: "free_shipping",
    q: "Is free shipping available?",
    a: "Free shipping eligibility is shown at checkout based on current policy and order value (often free above ₹1,099).",
  },
  {
    id: "tracking",
    q: "How can I track my order?",
    a: "When shipped, tracking details are shared by email/SMS. You can also check status in My orders on your account dashboard.",
  },
  {
    id: "cod",
    q: "Is Cash on Delivery (COD) available?",
    a: "COD may be offered at checkout depending on product value, location, and risk policies. Keep exact cash ready at delivery.",
  },
  {
    id: "pincode",
    q: "Do you deliver to my pin code / address?",
    a: "We ship across India to physical addresses (not P.O. boxes where couriers require a reachable address). Enter your 6-digit pin code at checkout to see options.",
  },
  {
    id: "cancel",
    q: "Can I cancel my order?",
    a: "You can cancel while the order is pending or confirmed (before dispatch). Once shipped, cancellation via the site may not be available — contact support.",
  },
  {
    id: "returns_window",
    q: "What is the return window?",
    a: "Delivered orders can be returned within 5 days of delivery if unused, unworn, with tags, and no return already in progress.",
  },
  {
    id: "refund_shipping",
    q: "Are shipping or COD fees refunded on returns?",
    a: "No — shipping charges and any COD handling fee are not refunded on approved returns. Refunds cover eligible product value only.",
  },
  {
    id: "payment_failed",
    q: "Payment failed but money was debited?",
    a: "Failed payments usually reverse within 3–7 business days. If not, contact support with your transaction reference.",
  },
  {
    id: "coupon",
    q: "Why is my coupon not working?",
    a: "Coupons may need a minimum order value, valid dates, or apply only to first-time purchases. Apply at checkout or contact support.",
  },
  {
    id: "sizing",
    q: "How do I pick the right blouse / saree size?",
    a: "Compare your measurements with the size chart on the product page. Sizes like S, M, L, XL, 2XL are listed per variant. If between sizes, the larger size is often more comfortable.",
  },
  {
    id: "damaged",
    q: "Item damaged or wrong product received?",
    a: "Contact support with your order number and clear photos. We will review and assist with replacement or resolution per policy.",
  },
] as const;

export function buildSupportFaqContext(): string {
  const lines = SUPPORT_FAQ_ENTRIES.map(
    (e) => `[${e.id}] Q: ${e.q}\nA: ${e.a}`,
  );
  return [
    `Brand: ${SUPPORT_CONTACT.brand}`,
    `Support phone: ${SUPPORT_CONTACT.phone}`,
    `Support email: ${SUPPORT_CONTACT.email}`,
    "",
    "FAQ entries (answer ONLY from these facts; do not invent policies):",
    ...lines,
  ].join("\n");
}

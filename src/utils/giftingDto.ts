/** Strip heavy fields and normalize gifting request for API responses. */
export function serializeGiftingRequest(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== 'object') return {};
  const out = { ...(doc as Record<string, unknown>) };
  if (Array.isArray(out.items)) {
    out.items = (out.items as Record<string, unknown>[]).map((item) => {
      const product = item.product;
      if (product && typeof product === 'object' && product !== null) {
        const p = product as Record<string, unknown>;
        return {
          ...item,
          product: {
            _id: p._id,
            name: p.name,
            description: p.description,
            images: p.images,
            price: p.price,
          },
        };
      }
      return item;
    });
  }
  if (out.user && typeof out.user === 'object') {
    const u = out.user as Record<string, unknown>;
    out.user = { _id: u._id, name: u.name, email: u.email, phone: u.phone };
  }
  return out;
}

export function serializeGiftingRequestList(docs: unknown[]): Record<string, unknown>[] {
  return docs.map((d) => serializeGiftingRequest(d));
}

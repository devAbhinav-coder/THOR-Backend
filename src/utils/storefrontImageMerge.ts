/**
 * Admin sends `settings` as JSON.stringify(). `undefined` fields are omitted, so
 * `imagePublicId` can be missing even when `image` still matches the DB. Without
 * the public id, cleanup thinks the asset is unused and deletes it from Cloudinary
 * while the URL string remains → broken images on other slides/banners.
 */

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** If next has image URL matching previous but no public id, restore from previous. */
export function mergeHeroSlides(
  payloadSlides: Record<string, unknown>[] | undefined,
  uploaded:
    | { hero: Record<string, { url: string; publicId: string }> }
    | undefined,
  previousSlides: Array<{ image?: string; imagePublicId?: string }> | undefined,
): Record<string, unknown>[] {
  return (payloadSlides || []).map((slide, index) => {
    const uploadedHero = uploaded?.hero?.[String(index)];
    if (uploadedHero) {
      return {
        ...slide,
        image: uploadedHero.url,
        imagePublicId: uploadedHero.publicId,
      };
    }
    const prev = previousSlides?.[index];
    const img = trimStr(slide.image);
    let pid = trimStr(slide.imagePublicId);
    const prevImg = trimStr(prev?.image);
    const prevPid = trimStr(prev?.imagePublicId);
    if (img && prevPid && prevImg === img && !pid) {
      return { ...slide, image: img, imagePublicId: prevPid };
    }
    return slide;
  });
}

export function mergeShopBanner(
  next: Record<string, unknown>,
  uploaded:
    | {
        shopBannerLeft?: { url: string; publicId: string };
        shopBannerCenter?: { url: string; publicId: string };
        shopBannerRight?: { url: string; publicId: string };
      }
    | undefined,
  prev: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = { ...next };
  const sides = [
    ["leftImage", "leftImagePublicId", uploaded?.shopBannerLeft] as const,
    ["centerImage", "centerImagePublicId", uploaded?.shopBannerCenter] as const,
    ["rightImage", "rightImagePublicId", uploaded?.shopBannerRight] as const,
  ];
  for (const [imgKey, idKey, up] of sides) {
    if (up) {
      out[imgKey] = up.url;
      out[idKey] = up.publicId;
    } else if (prev) {
      const nImg = trimStr(out[imgKey]);
      const nId = trimStr(out[idKey]);
      const pImg = trimStr(prev[imgKey]);
      const pId = trimStr(prev[idKey]);
      if (nImg && !nId && pImg === nImg && pId) {
        out[idKey] = pId;
      }
    }
  }
  return out;
}

export function mergePromoBanner(
  next: Record<string, unknown>,
  uploadedPromo: { url: string; publicId: string } | undefined,
  prev: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = { ...next };
  if (uploadedPromo) {
    out.backgroundImage = uploadedPromo.url;
    out.backgroundImagePublicId = uploadedPromo.publicId;
  } else if (prev) {
    const nImg = trimStr(out.backgroundImage);
    const nId = trimStr(out.backgroundImagePublicId);
    const pImg = trimStr(prev.backgroundImage);
    const pId = trimStr(prev.backgroundImagePublicId);
    if (nImg && !nId && pImg === nImg && pId) {
      out.backgroundImagePublicId = pId;
    }
  }
  return out;
}

export function mergeBlogBanner(
  next: Record<string, unknown>,
  uploaded:
    | {
        blogMain?: { url: string; publicId: string };
        blogSide?: { url: string; publicId: string };
      }
    | undefined,
  prev: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = { ...next };
  if (uploaded?.blogMain) {
    out.mainImage = uploaded.blogMain.url;
    out.mainImagePublicId = uploaded.blogMain.publicId;
  } else if (prev) {
    const nImg = trimStr(out.mainImage);
    const nId = trimStr(out.mainImagePublicId);
    const pImg = trimStr(prev.mainImage);
    const pId = trimStr(prev.mainImagePublicId);
    if (nImg && !nId && pImg === nImg && pId) {
      out.mainImagePublicId = pId;
    }
  }
  if (uploaded?.blogSide) {
    out.sideImage = uploaded.blogSide.url;
    out.sideImagePublicId = uploaded.blogSide.publicId;
  } else if (prev) {
    const nImg = trimStr(out.sideImage);
    const nId = trimStr(out.sideImagePublicId);
    const pImg = trimStr(prev.sideImage);
    const pId = trimStr(prev.sideImagePublicId);
    if (nImg && !nId && pImg === nImg && pId) {
      out.sideImagePublicId = pId;
    }
  }
  return out;
}

export function mergeGiftingHeroBanners(
  payloadBanners: Record<string, unknown>[] | undefined,
  uploaded:
    | { giftingHero: Record<string, { url: string; publicId: string }> }
    | undefined,
  previousBanners:
    | Array<{ backgroundImage?: string; backgroundImagePublicId?: string }>
    | undefined,
): Record<string, unknown>[] {
  return (payloadBanners || []).map((banner, index) => {
    const up = uploaded?.giftingHero?.[String(index)];
    if (up) {
      return {
        ...banner,
        backgroundImage: up.url,
        backgroundImagePublicId: up.publicId,
      };
    }
    const prev = previousBanners?.[index];
    const img = trimStr(banner.backgroundImage);
    const pid = trimStr(banner.backgroundImagePublicId);
    const prevImg = trimStr(prev?.backgroundImage);
    const prevPid = trimStr(prev?.backgroundImagePublicId);
    if (img && prevPid && prevImg === img && !pid) {
      return { ...banner, backgroundImagePublicId: prevPid };
    }
    return banner;
  });
}

export function mergeGiftingSecondaryBanners(
  payloadBanners: Record<string, unknown>[] | undefined,
  uploaded:
    | { giftingSecondary: Record<string, { url: string; publicId: string }> }
    | undefined,
  previousBanners:
    | Array<{ image?: string; imagePublicId?: string }>
    | undefined,
): Record<string, unknown>[] {
  return (payloadBanners || []).map((banner, index) => {
    const up = uploaded?.giftingSecondary?.[String(index)];
    if (up) {
      return {
        ...banner,
        image: up.url,
        imagePublicId: up.publicId,
      };
    }
    const prev = previousBanners?.[index];
    const img = trimStr(banner.image);
    const pid = trimStr(banner.imagePublicId);
    const prevImg = trimStr(prev?.image);
    const prevPid = trimStr(prev?.imagePublicId);
    if (img && prevPid && prevImg === img && !pid) {
      return { ...banner, imagePublicId: prevPid };
    }
    return banner;
  });
}

export function mergeHomeGiftCards(
  cards: Record<string, unknown>[],
  uploaded:
    | { homeGiftCard: Record<string, { url: string; publicId: string }> }
    | undefined,
  previousCards: Array<{ image?: string; imagePublicId?: string }> | undefined,
): Record<string, unknown>[] {
  return cards.map((card, index) => {
    const up = uploaded?.homeGiftCard?.[String(index)];
    if (up) {
      return { ...card, image: up.url, imagePublicId: up.publicId };
    }
    const img = typeof card.image === "string" ? card.image.trim() : "";
    if (!img) {
      const { imagePublicId: _removed, ...rest } = card;
      return { ...rest, image: "" };
    }
    let pid = trimStr(card.imagePublicId);
    const prev = previousCards?.[index];
    const prevImg = trimStr(prev?.image);
    const prevPid = trimStr(prev?.imagePublicId);
    if (prevPid && prevImg === img && !pid) {
      return { ...card, image: img, imagePublicId: prevPid };
    }
    return card;
  });
}

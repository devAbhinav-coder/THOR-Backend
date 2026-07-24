import { Request, Response } from "express";
import catchAsync from "../types/utils/catchAsync";
import StorefrontSettings from "../models/StorefrontSettings";
import { deleteMultipleImages } from "../services/cloudinary";
import { deleteCache, getCache, setCache } from "../services/cacheService";
import { storefrontRepository } from "../repositories/storefrontRepository";
import { safeJsonParse } from "../types/utils/safeJson";
import {
  mergeBlogBanner,
  mergeGiftingHeroBanners,
  mergeGiftingSecondaryBanners,
  mergeHeroSlides,
  mergeHomeEditorialTiles,
  mergeHomeGiftCards,
  mergePromoBanner,
  mergeShopBanner,
  mergeHomeMiddleBanner,
  mergeHomeExploreHouse,
} from "../types/utils/storefrontImageMerge";
import { sendSuccess } from "../types/utils/response";

const FALLBACK_SETTINGS = {
  announcementMessages: ["New arrivals added every week"],
  heroSlides: [
    {
      title: "Elegance in Every Thread",
      subtitle: "New Silk Saree Collection",
      description:
        "Discover our handwoven Banarasi and Kanjeevaram silk sarees for every celebration.",
      badge: "New Collection",
      image:
        "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80",
      ctaText: "Shop Sarees",
      ctaLink: "/shop?category=Sarees",
      secondaryCtaText: "View All",
      secondaryCtaLink: "/shop",
      isActive: true,
    },
  ],
  shopBanner: {
    title: "",
    subtitle: "",
    leftImage: "",
    leftImagePublicId: "",
    centerImage: "",
    centerImagePublicId: "",
    rightImage: "",
    rightImagePublicId: "",
    isActive: true,
  },
  promoBanner: {
    eyebrow: "The House of Rani",
    title: "Festive-ready pieces, crafted to feel timeless.",
    description:
      "Discover fresh drops across sarees, salwar suits, and corsets with rich fabrics and elegant drapes.",
    backgroundImage:
      "https://images.unsplash.com/photo-1520975958225-b3ea6a2c4bd0?w=1600&q=80&auto=format&fit=crop",
    primaryButtonText: "Shop New Arrivals",
    primaryButtonLink: "/shop/collections?sort=-createdAt",
    secondaryButtonText: "Browse All",
    secondaryButtonLink: "/shop/collections",
    perks: ["Premium fabrics", "Curated colors", "Easy to shop"],
  },
  homeEditorialGallery: {
    eyebrow: "",
    title: "",
    subtitle: "",
    ctaText: "",
    ctaLink: "",
    isActive: true,
    tiles: [],
  },
  homeMiddleBanner: {
    image: "https://images.unsplash.com/photo-1544441893-675973e31985?w=1600&q=80&auto=format&fit=crop",
    title: "Timeless Craftsmanship",
    subtitle: "A modern homage to our cultural legacy.",
    linkText: "Discover the Story",
    linkUrl: "/about",
    isActive: true,
  },
  homeExploreHouse: {
    saleImage:
      "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&q=85",
    saleName: "Sale",
    saleSubtitle: "ON OFFER",
    giftingImage:
      "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=600&q=85",
    giftingName: "Gifting",
    giftingSubtitle: "THE COLLECTION",
  },
  giftingHeroBanners: [
    {
      title: "Smart gifting made easy",
      description: "Premium gifts for every occasion, tailored to your style.",
      backgroundImage:
        "https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=1600&q=80&auto=format&fit=crop",
      ctaText: "Explore gifts",
      ctaLink: "/gifting",
      isActive: true,
    },
  ],
  giftingSecondaryBanners: [
    {
      eyebrow: "Gifting made premium",
      title: "Curated picks for every celebration",
      image:
        "https://images.unsplash.com/photo-1511988617509-a57c8a288659?w=1600&q=80&auto=format&fit=crop",
      ctaText: "Shop now",
      ctaLink: "/gifting",
      isActive: true,
    },
  ],
  homeGiftShowcase: {
    isActive: true,
    headlineLine1: "Our Gifting",
    headlineLine2: "Collections",
    description:
      "Also explore handmade gifts, corporate gifting, and curated hampers — perfect alongside our saree, salwar suit, and corset collections.",
    socialHandle: "@thehouseofrani",
    cards: [
      {
        title: "Handmade Gifts",
        description:
          "Artisan handmade gifts and pen presents with personal detail — perfect for birthdays, weddings, and thank-yous.",
        image:
          "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80",
        shopButtonText: "Browse gifts",
        shopLinkMode: "gifting",
        giftingSearch: "handmade",
        shopButtonLink: "/gifting/handmade-gifts",
        giftButtonText: "Gifting",
        giftButtonLink: "/gifting/handmade-gifts",
        accent: "rose",
      },
      {
        title: "Corporate Gifts",
        description:
          "Premium branded and bulk-friendly options for teams, clients, and events — easy to coordinate.",
        image:
          "https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=80",
        shopButtonText: "Browse gifts",
        shopLinkMode: "gifting",
        giftingSearch: "corporate",
        shopButtonLink: "/gifting/corporate-gifts",
        giftButtonText: "Gifting",
        giftButtonLink: "/gifting/corporate-gifts",
        accent: "amber",
      },
      {
        title: "Hampers",
        description:
          "Curated hampers and festive sets, beautifully arranged for gifting at a glance.",
        image:
          "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&q=80",
        shopButtonText: "Browse gifts",
        shopLinkMode: "gifting",
        giftingSearch: "hamper",
        shopButtonLink: "/gifting",
        giftButtonText: "Gifting",
        giftButtonLink: "/gifting",
        accent: "sage",
      },
    ],
  },
  footer: {
    description:
      "Your destination for exquisite Indian ethnic wear. Curated sarees, salwar suits, and corsets — crafted with love and tradition.",
    contactAddress: "123 Silk Road, Textile Market, Surat, Gujarat 395003",
    contactPhone: "+91 98765 43210",
    contactEmail: "hello@houseofrani.in",
    facebookUrl: "#",
    instagramUrl: "#",
    twitterUrl: "#",
    youtubeUrl: "#",
    quickLinks: [
      { label: "Home", href: "/" },
      { label: "Shop All", href: "/shop/collections" },
      { label: "About", href: "/about" },
      { label: "Journal", href: "/blog" },
      { label: "FAQ", href: "/faq" },
      { label: "Gifting", href: "/gifting" },
      { label: "Shipping", href: "/shipping" },
      { label: "Returns", href: "/returns" },
    ],
    categoryLimit: 5,
  },
};

type StorefrontPayload = {
  heroSlides?: Record<string, unknown>[];
  shopBanner?: Record<string, unknown>;
  promoBanner?: Record<string, unknown>;
  blogBanner?: Record<string, unknown>;
  giftingHeroBanners?: Record<string, unknown>[];
  giftingSecondaryBanners?: Record<string, unknown>[];
  homeGiftShowcase?: Record<string, unknown>;
  homeEditorialGallery?: Record<string, unknown>;
  homeMiddleBanner?: Record<string, unknown>;
  homeExploreHouse?: Record<string, unknown>;
  announcementMessages?: string[];
  footer?: Record<string, unknown>;
};

const LEGACY_HOME_GIFT_SNIPPET =
  "Handmade gifts, corporate gifting, and curated hampers";

function sanitizeHomeGiftDescription(desc: string): string {
  return desc.includes(LEGACY_HOME_GIFT_SNIPPET) ?
      FALLBACK_SETTINGS.homeGiftShowcase.description
    : desc;
}

function sanitizeFooterDescription(desc: string): string {
  if (desc.includes(LEGACY_HOME_GIFT_SNIPPET) || !desc.trim()) {
    return FALLBACK_SETTINGS.footer.description;
  }
  return desc;
}

/** Persist one-time SEO copy fix for live DB (non-blocking). */
function persistHomeSeoSanitizeIfNeeded(raw: Record<string, unknown>) {
  const giftDesc = String(
    (raw.homeGiftShowcase as { description?: string } | undefined)
      ?.description || "",
  );
  const footerDesc = String(
    (raw.footer as { description?: string } | undefined)?.description || "",
  );
  const needsGift = giftDesc.includes(LEGACY_HOME_GIFT_SNIPPET);
  const needsFooter =
    footerDesc.includes(LEGACY_HOME_GIFT_SNIPPET) || !footerDesc.trim();
  if (!needsGift && !needsFooter) return;
  const $set: Record<string, string> = {};
  if (needsGift) {
    $set["homeGiftShowcase.description"] =
      FALLBACK_SETTINGS.homeGiftShowcase.description;
  }
  if (needsFooter) {
    $set["footer.description"] = FALLBACK_SETTINGS.footer.description;
  }
  void StorefrontSettings.updateOne({}, { $set }).catch(() => {});
  void deleteCache("cache:storefront:settings:default").catch(() => {});
}

const getSettingsDoc = async () => {
  const cacheKey = "cache:storefront:settings:default";
  const cached = await getCache<typeof FALLBACK_SETTINGS>(cacheKey);
  if (cached) {
    const giftDesc = String(cached.homeGiftShowcase?.description || "");
    const footerDesc = String(cached.footer?.description || "");
    if (
      giftDesc.includes(LEGACY_HOME_GIFT_SNIPPET) ||
      footerDesc.includes(LEGACY_HOME_GIFT_SNIPPET)
    ) {
      void deleteCache(cacheKey).catch(() => {});
    } else {
      return cached;
    }
  }

  const settings = await storefrontRepository.getDefaultSettingsLean();
  if (!settings) return FALLBACK_SETTINGS;
  persistHomeSeoSanitizeIfNeeded(
    settings as unknown as Record<string, unknown>,
  );
  const payload = {
    announcementMessages:
      settings.announcementMessages?.length ?
        settings.announcementMessages
      : FALLBACK_SETTINGS.announcementMessages,
    heroSlides:
      settings.heroSlides?.length ?
        settings.heroSlides
      : FALLBACK_SETTINGS.heroSlides,
    shopBanner: settings.shopBanner || FALLBACK_SETTINGS.shopBanner,
    promoBanner: settings.promoBanner || FALLBACK_SETTINGS.promoBanner,
    blogBanner: settings.blogBanner || {
      eyebrow: "Journal & Stories",
      title: "Discover the Art of Ethnic",
      description:
        "Dive deep into the rich history of Indian textures, get styling tips from experts, and stay updated with our latest collections and pop-up stalls.",
      mainImage:
        "https://images.unsplash.com/photo-1610030469983-98e550d615ef?w=1200&q=80",
      sideImage:
        "https://images.unsplash.com/photo-1583391733958-d25e07fac0ec?w=800&q=80",
      buttonText: "Visit Our Blog",
      buttonLink: "/blog",
      isActive: true,
    },
    giftingHeroBanners:
      settings.giftingHeroBanners?.length ?
        settings.giftingHeroBanners
      : FALLBACK_SETTINGS.giftingHeroBanners,
    giftingSecondaryBanners:
      settings.giftingSecondaryBanners?.length ?
        settings.giftingSecondaryBanners
      : FALLBACK_SETTINGS.giftingSecondaryBanners,
    homeGiftShowcase:
      settings.homeGiftShowcase || FALLBACK_SETTINGS.homeGiftShowcase,
    homeEditorialGallery:
      settings.homeEditorialGallery || FALLBACK_SETTINGS.homeEditorialGallery,
    homeMiddleBanner:
      settings.homeMiddleBanner || FALLBACK_SETTINGS.homeMiddleBanner,
    homeExploreHouse:
      settings.homeExploreHouse || FALLBACK_SETTINGS.homeExploreHouse,
    footer: settings.footer || FALLBACK_SETTINGS.footer,
  };
  const giftShowcase = payload.homeGiftShowcase as {
    description?: string;
  };
  giftShowcase.description = sanitizeHomeGiftDescription(
    String(
      giftShowcase.description ||
        FALLBACK_SETTINGS.homeGiftShowcase.description,
    ),
  );
  const footerBlock = payload.footer as { description?: string };
  footerBlock.description = sanitizeFooterDescription(
    String(footerBlock.description || FALLBACK_SETTINGS.footer.description),
  );
  await setCache(cacheKey, payload, 120);
  return payload;
};

export const getStorefrontSettings = catchAsync(
  async (_req: Request, res: Response) => {
    const settings = await getSettingsDoc();
    sendSuccess(res, { settings });
  },
);

export const getAdminStorefrontSettings = catchAsync(
  async (_req: Request, res: Response) => {
    const settings = await getSettingsDoc();
    sendSuccess(res, { settings });
  },
);

export const updateStorefrontSettings = catchAsync(
  async (req: Request, res: Response) => {
    const payload = safeJsonParse<StorefrontPayload>(
      req.body.settings,
      (req.body || {}) as StorefrontPayload,
      "settings",
    );
    const uploaded = (
      req as Request & {
        uploadedStorefrontImages?: {
          hero: Record<string, { url: string; publicId: string }>;
          promo?: { url: string; publicId: string };
          blogMain?: { url: string; publicId: string };
          blogSide?: { url: string; publicId: string };
          shopBannerLeft?: { url: string; publicId: string };
          shopBannerCenter?: { url: string; publicId: string };
          shopBannerRight?: { url: string; publicId: string };
          giftingHero: Record<string, { url: string; publicId: string }>;
          giftingSecondary: Record<string, { url: string; publicId: string }>;
          homeGiftCard: Record<string, { url: string; publicId: string }>;
          homeEditorialTile: Record<string, { url: string; publicId: string }>;
          homeMiddleBanner?: { url: string; publicId: string };
          homeExploreHouseSale?: { url: string; publicId: string };
          homeExploreHouseGifting?: { url: string; publicId: string };
        };
      }
    ).uploadedStorefrontImages;

    const previous = await StorefrontSettings.findOne({
      key: "default",
    }).lean();

    const prevHeroSlides = previous?.heroSlides as
      | Array<{ image?: string; imagePublicId?: string }>
      | undefined;

    const nextHeroSlides = mergeHeroSlides(
      payload.heroSlides as Record<string, unknown>[] | undefined,
      uploaded,
      prevHeroSlides,
    );

    const prevShop = previous?.shopBanner as
      | Record<string, unknown>
      | undefined;
    const nextShopBanner = mergeShopBanner(
      { ...(payload.shopBanner || {}) },
      uploaded,
      prevShop,
    );

    const prevPromo = previous?.promoBanner as
      | Record<string, unknown>
      | undefined;
    const nextPromo = mergePromoBanner(
      { ...(payload.promoBanner || {}) },
      uploaded?.promo,
      prevPromo,
    );

    const prevBlog = previous?.blogBanner as
      | Record<string, unknown>
      | undefined;
    const nextBlogBanner = mergeBlogBanner(
      { ...(payload.blogBanner || {}) },
      uploaded ?
        {
          blogMain: uploaded.blogMain,
          blogSide: uploaded.blogSide,
        }
      : undefined,
      prevBlog,
    );

    const prevHomeMiddleBanner = previous?.homeMiddleBanner as Record<string, unknown> | undefined;
    const nextHomeMiddleBanner = mergeHomeMiddleBanner(
      { ...(payload.homeMiddleBanner || {}) },
      uploaded?.homeMiddleBanner,
      prevHomeMiddleBanner
    );

    const prevHomeExploreHouse = previous?.homeExploreHouse as
      | Record<string, unknown>
      | undefined;
    const nextHomeExploreHouse = mergeHomeExploreHouse(
      { ...(payload.homeExploreHouse || {}) },
      uploaded ?
        {
          sale: uploaded.homeExploreHouseSale,
          gifting: uploaded.homeExploreHouseGifting,
        }
      : undefined,
      prevHomeExploreHouse,
    );

    const prevGiftingHero = previous?.giftingHeroBanners as
      | Array<{ backgroundImage?: string; backgroundImagePublicId?: string }>
      | undefined;
    const nextGiftingHero = mergeGiftingHeroBanners(
      payload.giftingHeroBanners as Record<string, unknown>[] | undefined,
      uploaded,
      prevGiftingHero,
    );

    const prevGiftingSecondary = previous?.giftingSecondaryBanners as
      | Array<{ image?: string; imagePublicId?: string }>
      | undefined;
    const nextGiftingSecondary = mergeGiftingSecondaryBanners(
      payload.giftingSecondaryBanners as Record<string, unknown>[] | undefined,
      uploaded,
      prevGiftingSecondary,
    );

    const showcasePayload = (payload.homeGiftShowcase || {}) as Record<
      string,
      unknown
    >;
    const cardsIn =
      Array.isArray(showcasePayload.cards) ?
        (showcasePayload.cards as Record<string, unknown>[])
      : [];
    const prevGiftCards = (
      previous?.homeGiftShowcase as
        | { cards?: Array<{ image?: string; imagePublicId?: string }> }
        | undefined
    )?.cards;
    const nextGiftCards = mergeHomeGiftCards(
      cardsIn.slice(0, 3),
      uploaded,
      prevGiftCards,
    );
    const nextHomeGiftShowcase = {
      ...FALLBACK_SETTINGS.homeGiftShowcase,
      ...showcasePayload,
      cards: nextGiftCards,
    };

    const editorialPayload = (payload.homeEditorialGallery ||
      {}) as Record<string, unknown>;
    const editorialTilesIn =
      Array.isArray(editorialPayload.tiles) ?
        (editorialPayload.tiles as Record<string, unknown>[])
      : [];
    const prevEditorialTiles = (
      previous?.homeEditorialGallery as
        | { tiles?: Array<{ image?: string; imagePublicId?: string }> }
        | undefined
    )?.tiles;
    const nextEditorialTiles = mergeHomeEditorialTiles(
      editorialTilesIn.slice(0, 3),
      uploaded,
      prevEditorialTiles,
    );
    const nextHomeEditorialGallery = {
      ...FALLBACK_SETTINGS.homeEditorialGallery,
      ...editorialPayload,
      tiles: nextEditorialTiles,
    };

    const usedPublicIds = new Set<string>();
    for (const slide of nextHeroSlides) {
      if (
        typeof slide.imagePublicId === "string" &&
        slide.imagePublicId.trim()
      ) {
        usedPublicIds.add(slide.imagePublicId);
      }
    }
    if (
      typeof nextPromo.backgroundImagePublicId === "string" &&
      nextPromo.backgroundImagePublicId.trim()
    ) {
      usedPublicIds.add(nextPromo.backgroundImagePublicId);
    }
    if (
      typeof nextShopBanner.leftImagePublicId === "string" &&
      nextShopBanner.leftImagePublicId.trim()
    ) {
      usedPublicIds.add(nextShopBanner.leftImagePublicId);
    }
    if (
      typeof nextShopBanner.centerImagePublicId === "string" &&
      nextShopBanner.centerImagePublicId.trim()
    ) {
      usedPublicIds.add(nextShopBanner.centerImagePublicId);
    }
    if (
      typeof nextShopBanner.rightImagePublicId === "string" &&
      nextShopBanner.rightImagePublicId.trim()
    ) {
      usedPublicIds.add(nextShopBanner.rightImagePublicId);
    }
    if (
      typeof nextBlogBanner.mainImagePublicId === "string" &&
      nextBlogBanner.mainImagePublicId.trim()
    ) {
      usedPublicIds.add(nextBlogBanner.mainImagePublicId);
    }
    if (
      typeof nextBlogBanner.sideImagePublicId === "string" &&
      nextBlogBanner.sideImagePublicId.trim()
    ) {
      usedPublicIds.add(nextBlogBanner.sideImagePublicId);
    }
    if (
      typeof nextHomeMiddleBanner.imagePublicId === "string" &&
      nextHomeMiddleBanner.imagePublicId.trim()
    ) {
      usedPublicIds.add(nextHomeMiddleBanner.imagePublicId);
    }
    if (
      typeof nextHomeExploreHouse.saleImagePublicId === "string" &&
      nextHomeExploreHouse.saleImagePublicId.trim()
    ) {
      usedPublicIds.add(nextHomeExploreHouse.saleImagePublicId);
    }
    if (
      typeof nextHomeExploreHouse.giftingImagePublicId === "string" &&
      nextHomeExploreHouse.giftingImagePublicId.trim()
    ) {
      usedPublicIds.add(nextHomeExploreHouse.giftingImagePublicId);
    }
    for (const banner of nextGiftingHero) {
      if (
        typeof banner.backgroundImagePublicId === "string" &&
        banner.backgroundImagePublicId.trim()
      ) {
        usedPublicIds.add(banner.backgroundImagePublicId);
      }
    }
    for (const banner of nextGiftingSecondary) {
      if (
        typeof banner.imagePublicId === "string" &&
        banner.imagePublicId.trim()
      ) {
        usedPublicIds.add(banner.imagePublicId);
      }
    }
    for (const card of nextGiftCards as Array<{ imagePublicId?: string }>) {
      if (typeof card.imagePublicId === "string" && card.imagePublicId.trim()) {
        usedPublicIds.add(card.imagePublicId);
      }
    }
    for (const tile of nextEditorialTiles as Array<{ imagePublicId?: string }>) {
      if (typeof tile.imagePublicId === "string" && tile.imagePublicId.trim()) {
        usedPublicIds.add(tile.imagePublicId);
      }
    }

    const oldPublicIds: string[] = [];
    if (previous?.heroSlides?.length) {
      for (const slide of previous.heroSlides as Array<{
        imagePublicId?: string;
      }>) {
        if (slide.imagePublicId) oldPublicIds.push(slide.imagePublicId);
      }
    }
    if (previous?.promoBanner && typeof previous.promoBanner === "object") {
      const maybePromo = previous.promoBanner as {
        backgroundImagePublicId?: string;
      };
      if (maybePromo.backgroundImagePublicId)
        oldPublicIds.push(maybePromo.backgroundImagePublicId);
    }
    if (previous?.shopBanner && typeof previous.shopBanner === "object") {
      const maybeShopBanner = previous.shopBanner as {
        leftImagePublicId?: string;
        centerImagePublicId?: string;
        rightImagePublicId?: string;
      };
      if (maybeShopBanner.leftImagePublicId)
        oldPublicIds.push(maybeShopBanner.leftImagePublicId);
      if (maybeShopBanner.centerImagePublicId)
        oldPublicIds.push(maybeShopBanner.centerImagePublicId);
      if (maybeShopBanner.rightImagePublicId)
        oldPublicIds.push(maybeShopBanner.rightImagePublicId);
    }
    if (previous?.blogBanner && typeof previous.blogBanner === "object") {
      const maybeBlog = previous.blogBanner as {
        mainImagePublicId?: string;
        sideImagePublicId?: string;
      };
      if (maybeBlog.mainImagePublicId)
        oldPublicIds.push(maybeBlog.mainImagePublicId);
      if (maybeBlog.sideImagePublicId)
        oldPublicIds.push(maybeBlog.sideImagePublicId);
    }
    if (previous?.homeMiddleBanner && typeof previous.homeMiddleBanner === "object") {
      const maybeHomeMiddle = previous.homeMiddleBanner as { imagePublicId?: string };
      if (maybeHomeMiddle.imagePublicId) oldPublicIds.push(maybeHomeMiddle.imagePublicId);
    }
    if (previous?.homeExploreHouse && typeof previous.homeExploreHouse === "object") {
      const maybeExplore = previous.homeExploreHouse as {
        saleImagePublicId?: string;
        giftingImagePublicId?: string;
      };
      if (maybeExplore.saleImagePublicId) {
        oldPublicIds.push(maybeExplore.saleImagePublicId);
      }
      if (maybeExplore.giftingImagePublicId) {
        oldPublicIds.push(maybeExplore.giftingImagePublicId);
      }
    }
    if (previous?.giftingHeroBanners?.length) {
      for (const banner of previous.giftingHeroBanners as Array<{
        backgroundImagePublicId?: string;
      }>) {
        if (banner.backgroundImagePublicId)
          oldPublicIds.push(banner.backgroundImagePublicId);
      }
    }
    if (previous?.giftingSecondaryBanners?.length) {
      for (const banner of previous.giftingSecondaryBanners as Array<{
        imagePublicId?: string;
      }>) {
        if (banner.imagePublicId) oldPublicIds.push(banner.imagePublicId);
      }
    }
    const prevGift = previous?.homeGiftShowcase as
      | { cards?: Array<{ imagePublicId?: string }> }
      | undefined;
    if (prevGift?.cards?.length) {
      for (const card of prevGift.cards) {
        if (card.imagePublicId) oldPublicIds.push(card.imagePublicId);
      }
    }
    const prevEditorial = previous?.homeEditorialGallery as
      | { tiles?: Array<{ imagePublicId?: string }> }
      | undefined;
    if (prevEditorial?.tiles?.length) {
      for (const tile of prevEditorial.tiles) {
        if (tile.imagePublicId) oldPublicIds.push(tile.imagePublicId);
      }
    }

    const stalePublicIds = oldPublicIds.filter((id) => !usedPublicIds.has(id));
    if (stalePublicIds.length > 0) {
      await deleteMultipleImages(stalePublicIds);
    }

    const updated = await StorefrontSettings.findOneAndUpdate(
      { key: "default" },
      {
        key: "default",
        announcementMessages: payload.announcementMessages || [],
        heroSlides: nextHeroSlides,
        shopBanner: nextShopBanner,
        promoBanner: nextPromo,
        blogBanner: nextBlogBanner,
        giftingHeroBanners: nextGiftingHero,
        giftingSecondaryBanners: nextGiftingSecondary,
        homeGiftShowcase: nextHomeGiftShowcase,
        homeEditorialGallery: nextHomeEditorialGallery,
        homeMiddleBanner: nextHomeMiddleBanner,
        homeExploreHouse: nextHomeExploreHouse,
        footer: payload.footer || {},
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    sendSuccess(res, { settings: updated }, "Storefront settings updated");
    await deleteCache("cache:storefront:settings:default");
  },
);

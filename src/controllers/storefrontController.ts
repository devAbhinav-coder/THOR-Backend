import { Request, Response } from "express";
import catchAsync from "../utils/catchAsync";
import StorefrontSettings from "../models/StorefrontSettings";
import { deleteMultipleImages } from "../services/cloudinary";
import { deleteCache, getCache, setCache } from "../services/cacheService";
import { storefrontRepository } from "../repositories/storefrontRepository";
import { safeJsonParse } from "../utils/safeJson";
import { sendSuccess } from "../utils/response";

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
    title: "Shop Our Collection",
    subtitle: "Discover premium ethnic wear crafted for every occasion.",
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
      "Discover fresh drops across sarees, lehengas, and more with rich fabrics and elegant drapes.",
    backgroundImage:
      "https://images.unsplash.com/photo-1520975958225-b3ea6a2c4bd0?w=1600&q=80&auto=format&fit=crop",
    primaryButtonText: "Shop New Arrivals",
    primaryButtonLink: "/shop?sort=-createdAt",
    secondaryButtonText: "Browse All",
    secondaryButtonLink: "/shop",
    perks: ["Premium fabrics", "Curated colors", "Easy to shop"],
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
      "Handmade gifts, corporate gifting, and curated hampers — everything you need for celebrations, clients, and loved ones. Browse ready-to-ship pieces or start a custom gifting request.",
    socialHandle: "@thehouseofrani",
    cards: [
      {
        title: "Handmade Gifts",
        description:
          "Thoughtful, artisan-style pieces with personal detail — perfect for birthdays, weddings, and thank-yous.",
        image:
          "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80",
        shopButtonText: "Browse gifts",
        shopLinkMode: "gifting",
        giftingSearch: "handmade",
        shopButtonLink: "/gifting",
        giftButtonText: "Gifting",
        giftButtonLink: "/gifting",
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
        shopButtonLink: "/gifting",
        giftButtonText: "Gifting",
        giftButtonLink: "/gifting",
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
      "Your destination for exquisite Indian ethnic wear. Curated sarees, lehengas, and more.",
    contactAddress: "123 Silk Road, Textile Market, Surat, Gujarat 395003",
    contactPhone: "+91 98765 43210",
    contactEmail: "hello@houseofrani.in",
    facebookUrl: "#",
    instagramUrl: "#",
    twitterUrl: "#",
    youtubeUrl: "#",
    quickLinks: [
      { label: "Home", href: "/" },
      { label: "Shop All", href: "/shop" },
      { label: "New Arrivals", href: "/shop?sort=-createdAt" },
      { label: "Featured", href: "/shop?isFeatured=true" },
      { label: "Cart", href: "/cart" },
    ],
    categoryLimit: 7,
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
  announcementMessages?: string[];
  footer?: Record<string, unknown>;
};

const getSettingsDoc = async () => {
  const cacheKey = "cache:storefront:settings:default";
  const cached = await getCache<typeof FALLBACK_SETTINGS>(cacheKey);
  if (cached) return cached;

  const settings = await storefrontRepository.getDefaultSettingsLean();
  if (!settings) return FALLBACK_SETTINGS;
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
    footer: settings.footer || FALLBACK_SETTINGS.footer,
  };
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
        };
      }
    ).uploadedStorefrontImages;

    const previous = await StorefrontSettings.findOne({
      key: "default",
    }).lean();

    const nextHeroSlides = (payload.heroSlides || []).map(
      (slide: Record<string, unknown>, index: number) => {
        const uploadedHero = uploaded?.hero?.[String(index)];
        if (uploadedHero) {
          return {
            ...slide,
            image: uploadedHero.url,
            imagePublicId: uploadedHero.publicId,
          };
        }
        return slide;
      },
    );

    const nextShopBanner = { ...(payload.shopBanner || {}) };
    if (uploaded?.shopBannerLeft) {
      nextShopBanner.leftImage = uploaded.shopBannerLeft.url;
      nextShopBanner.leftImagePublicId = uploaded.shopBannerLeft.publicId;
    }
    if (uploaded?.shopBannerCenter) {
      nextShopBanner.centerImage = uploaded.shopBannerCenter.url;
      nextShopBanner.centerImagePublicId = uploaded.shopBannerCenter.publicId;
    }
    if (uploaded?.shopBannerRight) {
      nextShopBanner.rightImage = uploaded.shopBannerRight.url;
      nextShopBanner.rightImagePublicId = uploaded.shopBannerRight.publicId;
    }

    const nextPromo = { ...(payload.promoBanner || {}) };
    if (uploaded?.promo) {
      nextPromo.backgroundImage = uploaded.promo.url;
      nextPromo.backgroundImagePublicId = uploaded.promo.publicId;
    }

    const nextBlogBanner = { ...(payload.blogBanner || {}) };
    if (uploaded?.blogMain) {
      nextBlogBanner.mainImage = uploaded.blogMain.url;
      nextBlogBanner.mainImagePublicId = uploaded.blogMain.publicId;
    }
    if (uploaded?.blogSide) {
      nextBlogBanner.sideImage = uploaded.blogSide.url;
      nextBlogBanner.sideImagePublicId = uploaded.blogSide.publicId;
    }

    const nextGiftingHero = (payload.giftingHeroBanners || []).map(
      (banner: Record<string, unknown>, index: number) => {
        const uploadedHero = uploaded?.giftingHero?.[String(index)];
        if (uploadedHero) {
          return {
            ...banner,
            backgroundImage: uploadedHero.url,
            backgroundImagePublicId: uploadedHero.publicId,
          };
        }
        return banner;
      },
    );

    const nextGiftingSecondary = (payload.giftingSecondaryBanners || []).map(
      (banner: Record<string, unknown>, index: number) => {
        const uploadedSecondary = uploaded?.giftingSecondary?.[String(index)];
        if (uploadedSecondary) {
          return {
            ...banner,
            image: uploadedSecondary.url,
            imagePublicId: uploadedSecondary.publicId,
          };
        }
        return banner;
      },
    );

    const showcasePayload = (payload.homeGiftShowcase || {}) as Record<
      string,
      unknown
    >;
    const cardsIn =
      Array.isArray(showcasePayload.cards) ?
        (showcasePayload.cards as Record<string, unknown>[])
      : [];
    const nextGiftCards = cardsIn.slice(0, 3).map((card, index) => {
      const up = uploaded?.homeGiftCard?.[String(index)];
      if (up) {
        return { ...card, image: up.url, imagePublicId: up.publicId };
      }
      const img = typeof card.image === "string" ? card.image.trim() : "";
      if (!img) {
        const { imagePublicId: _removed, ...rest } = card;
        return { ...rest, image: "" };
      }
      return card;
    });
    const nextHomeGiftShowcase = {
      ...FALLBACK_SETTINGS.homeGiftShowcase,
      ...showcasePayload,
      cards: nextGiftCards,
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

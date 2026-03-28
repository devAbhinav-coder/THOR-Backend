import { Request, Response } from 'express';
import catchAsync from '../utils/catchAsync';
import StorefrontSettings from '../models/StorefrontSettings';
import { deleteMultipleImages } from '../services/cloudinary';

const FALLBACK_SETTINGS = {
  announcementMessages: [
    'Use code WELCOME10 on your first order',
    'Free shipping on orders above ₹999',
    'New arrivals added every week',
  ],
  heroSlides: [
    {
      title: 'Elegance in Every Thread',
      subtitle: 'New Silk Saree Collection',
      description:
        'Discover our handwoven Banarasi and Kanjeevaram silk sarees for every celebration.',
      badge: 'New Collection',
      image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80',
      ctaText: 'Shop Sarees',
      ctaLink: '/shop?category=Sarees',
      secondaryCtaText: 'View All',
      secondaryCtaLink: '/shop',
      isActive: true,
    },
    {
      title: 'Bridal Dreams Come True',
      subtitle: 'Exclusive Lehenga Collection',
      description: 'Premium bridal lehengas crafted for your special moments.',
      badge: 'Bridal Edit',
      image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=1200&q=80',
      ctaText: 'Explore Lehengas',
      ctaLink: '/shop?category=Lehengas',
      secondaryCtaText: 'View All',
      secondaryCtaLink: '/shop',
      isActive: true,
    },
    {
      title: 'Casual Chic Every Day',
      subtitle: 'Designer Kurtis & Suits',
      description: 'Effortlessly stylish kurtis and salwar suits for every mood and every day.',
      badge: 'Best Sellers',
      image: 'https://images.unsplash.com/photo-1600950207944-0d63e8edbc3f?w=1200&q=80',
      ctaText: 'Shop Kurtis',
      ctaLink: '/shop?category=Kurtis',
      secondaryCtaText: 'View All',
      secondaryCtaLink: '/shop',
      isActive: true,
    },
  ],
  promoBanner: {
    eyebrow: 'The House of Rani',
    title: 'Festive-ready pieces, crafted to feel timeless.',
    description:
      'Discover fresh drops across sarees, lehengas, and more with rich fabrics and elegant drapes.',
    backgroundImage:
      'https://images.unsplash.com/photo-1520975958225-b3ea6a2c4bd0?w=1600&q=80&auto=format&fit=crop',
    primaryButtonText: 'Shop New Arrivals',
    primaryButtonLink: '/shop?sort=-createdAt',
    secondaryButtonText: 'Browse All',
    secondaryButtonLink: '/shop',
    perks: ['Premium fabrics', 'Curated colors', 'Easy to shop'],
  },
  footer: {
    description:
      'Your destination for exquisite Indian ethnic wear. Curated sarees, lehengas, and more.',
    contactAddress: '123 Silk Road, Textile Market, Surat, Gujarat 395003',
    contactPhone: '+91 98765 43210',
    contactEmail: 'hello@houseofrani.in',
    facebookUrl: '#',
    instagramUrl: '#',
    twitterUrl: '#',
    youtubeUrl: '#',
    quickLinks: [
      { label: 'Home', href: '/' },
      { label: 'Shop All', href: '/shop' },
      { label: 'New Arrivals', href: '/shop?sort=-createdAt' },
      { label: 'Featured', href: '/shop?isFeatured=true' },
      { label: 'Cart', href: '/cart' },
    ],
    categoryLimit: 7,
  },
};

const getSettingsDoc = async () => {
  const settings = await StorefrontSettings.findOne({ key: 'default' }).lean();
  if (!settings) return FALLBACK_SETTINGS;
  return {
    announcementMessages: settings.announcementMessages?.length ? settings.announcementMessages : FALLBACK_SETTINGS.announcementMessages,
    heroSlides: settings.heroSlides?.length ? settings.heroSlides : FALLBACK_SETTINGS.heroSlides,
    promoBanner: settings.promoBanner || FALLBACK_SETTINGS.promoBanner,
    blogBanner: settings.blogBanner || {
      eyebrow: 'Journal & Stories',
      title: 'Discover the Art of Ethnic',
      description: 'Dive deep into the rich history of Indian textures, get styling tips from experts, and stay updated with our latest collections and pop-up stalls.',
      mainImage: 'https://images.unsplash.com/photo-1610030469983-98e550d615ef?w=1200&q=80',
      sideImage: 'https://images.unsplash.com/photo-1583391733958-d25e07fac0ec?w=800&q=80',
      buttonText: 'Visit Our Blog',
      buttonLink: '/blog',
      isActive: true,
    },
    footer: settings.footer || FALLBACK_SETTINGS.footer,
  };
};

export const getStorefrontSettings = catchAsync(async (_req: Request, res: Response) => {
  const settings = await getSettingsDoc();
  res.status(200).json({ status: 'success', data: { settings } });
});

export const getAdminStorefrontSettings = catchAsync(async (_req: Request, res: Response) => {
  const settings = await getSettingsDoc();
  res.status(200).json({ status: 'success', data: { settings } });
});

export const updateStorefrontSettings = catchAsync(async (req: Request, res: Response) => {
  const payload = typeof req.body.settings === 'string' ? JSON.parse(req.body.settings) : (req.body || {});
  const uploaded = (req as Request & {
    uploadedStorefrontImages?: {
      hero: Record<string, { url: string; publicId: string }>;
      promo?: { url: string; publicId: string };
      blogMain?: { url: string; publicId: string };
      blogSide?: { url: string; publicId: string };
    };
  }).uploadedStorefrontImages;

  const previous = await StorefrontSettings.findOne({ key: 'default' }).lean();

  const nextHeroSlides = (payload.heroSlides || []).map((slide: Record<string, unknown>, index: number) => {
    const uploadedHero = uploaded?.hero?.[String(index)];
    if (uploadedHero) {
      return { ...slide, image: uploadedHero.url, imagePublicId: uploadedHero.publicId };
    }
    return slide;
  });

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

  const usedPublicIds = new Set<string>();
  for (const slide of nextHeroSlides) {
    if (typeof slide.imagePublicId === 'string' && slide.imagePublicId.trim()) {
      usedPublicIds.add(slide.imagePublicId);
    }
  }
  if (typeof nextPromo.backgroundImagePublicId === 'string' && nextPromo.backgroundImagePublicId.trim()) {
    usedPublicIds.add(nextPromo.backgroundImagePublicId);
  }
  if (typeof nextBlogBanner.mainImagePublicId === 'string' && nextBlogBanner.mainImagePublicId.trim()) {
    usedPublicIds.add(nextBlogBanner.mainImagePublicId);
  }
  if (typeof nextBlogBanner.sideImagePublicId === 'string' && nextBlogBanner.sideImagePublicId.trim()) {
    usedPublicIds.add(nextBlogBanner.sideImagePublicId);
  }

  const oldPublicIds: string[] = [];
  if (previous?.heroSlides?.length) {
    for (const slide of previous.heroSlides as Array<{ imagePublicId?: string }>) {
      if (slide.imagePublicId) oldPublicIds.push(slide.imagePublicId);
    }
  }
  if (previous?.promoBanner && typeof previous.promoBanner === 'object') {
    const maybePromo = previous.promoBanner as { backgroundImagePublicId?: string };
    if (maybePromo.backgroundImagePublicId) oldPublicIds.push(maybePromo.backgroundImagePublicId);
  }
  if (previous?.blogBanner && typeof previous.blogBanner === 'object') {
    const maybeBlog = previous.blogBanner as { mainImagePublicId?: string; sideImagePublicId?: string };
    if (maybeBlog.mainImagePublicId) oldPublicIds.push(maybeBlog.mainImagePublicId);
    if (maybeBlog.sideImagePublicId) oldPublicIds.push(maybeBlog.sideImagePublicId);
  }

  const stalePublicIds = oldPublicIds.filter((id) => !usedPublicIds.has(id));
  if (stalePublicIds.length > 0) {
    await deleteMultipleImages(stalePublicIds);
  }

  const updated = await StorefrontSettings.findOneAndUpdate(
    { key: 'default' },
    {
      key: 'default',
      announcementMessages: payload.announcementMessages || [],
      heroSlides: nextHeroSlides,
      promoBanner: nextPromo,
      blogBanner: nextBlogBanner,
      footer: payload.footer || {},
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({
    status: 'success',
    data: { settings: updated },
  });
});

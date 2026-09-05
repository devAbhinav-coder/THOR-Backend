import mongoose, { Schema } from 'mongoose';

const heroSlideSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 400 },
    badge: { type: String, trim: true, maxlength: 60 },
    image: { type: String, required: true, trim: true },
    imagePublicId: { type: String, trim: true },
    ctaText: { type: String, trim: true, maxlength: 40 },
    ctaLink: { type: String, trim: true, maxlength: 240 },
    secondaryCtaText: { type: String, trim: true, maxlength: 40 },
    secondaryCtaLink: { type: String, trim: true, maxlength: 240 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const linkSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    href: { type: String, required: true, trim: true, maxlength: 240 },
  },
  { _id: false }
);

const promoBannerSchema = new Schema(
  {
    eyebrow: { type: String, trim: true, maxlength: 80 },
    title: { type: String, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 400 },
    backgroundImage: { type: String, trim: true },
    backgroundImagePublicId: { type: String, trim: true },
    primaryButtonText: { type: String, trim: true, maxlength: 40 },
    primaryButtonLink: { type: String, trim: true, maxlength: 240 },
    secondaryButtonText: { type: String, trim: true, maxlength: 40 },
    secondaryButtonLink: { type: String, trim: true, maxlength: 240 },
    perks: [{ type: String, trim: true, maxlength: 120 }],
  },
  { _id: false }
);

const shopBannerSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 140 },
    subtitle: { type: String, trim: true, maxlength: 260 },
    leftImage: { type: String, trim: true },
    leftImagePublicId: { type: String, trim: true },
    centerImage: { type: String, trim: true },
    centerImagePublicId: { type: String, trim: true },
    rightImage: { type: String, trim: true },
    rightImagePublicId: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const footerSchema = new Schema(
  {
    description: { type: String, trim: true, maxlength: 500 },
    contactAddress: { type: String, trim: true, maxlength: 240 },
    contactPhone: { type: String, trim: true, maxlength: 40 },
    contactEmail: { type: String, trim: true, maxlength: 120 },
    facebookUrl: { type: String, trim: true, maxlength: 240 },
    instagramUrl: { type: String, trim: true, maxlength: 240 },
    twitterUrl: { type: String, trim: true, maxlength: 240 },
    youtubeUrl: { type: String, trim: true, maxlength: 240 },
    quickLinks: [linkSchema],
    categoryLimit: { type: Number, default: 5, min: 1, max: 20 },
  },
  { _id: false }
);

const blogBannerSchema = new Schema(
  {
    eyebrow: { type: String, trim: true, maxlength: 80, default: 'Journal & Stories' },
    title: { type: String, trim: true, maxlength: 140, default: 'Discover the Art of Ethnic' },
    description: { type: String, trim: true, maxlength: 400 },
    mainImage: { type: String, trim: true },
    mainImagePublicId: { type: String, trim: true },
    sideImage: { type: String, trim: true },
    sideImagePublicId: { type: String, trim: true },
    buttonText: { type: String, trim: true, maxlength: 40, default: 'Visit Our Blog' },
    buttonLink: { type: String, trim: true, maxlength: 240, default: '/blog' },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const giftingHeroBannerSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 400 },
    backgroundImage: { type: String, trim: true },
    backgroundImagePublicId: { type: String, trim: true },
    ctaText: { type: String, trim: true, maxlength: 40 },
    ctaLink: { type: String, trim: true, maxlength: 240 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const giftingSecondaryBannerSchema = new Schema(
  {
    eyebrow: { type: String, trim: true, maxlength: 80 },
    title: { type: String, trim: true, maxlength: 140 },
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    ctaText: { type: String, trim: true, maxlength: 40 },
    ctaLink: { type: String, trim: true, maxlength: 240 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

/** Home page — above “Why Choose Us”; three pastel cards + dual CTAs (shop vs gifting). */
const homeGiftShowcaseCardSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 320 },
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    shopButtonText: { type: String, trim: true, maxlength: 36, default: 'Shop products' },
    shopButtonLink: { type: String, trim: true, maxlength: 240, default: '/shop' },
    /** Primary CTA: gifting filters, direct product path, custom URL, or coming soon (no link). */
    shopLinkMode: {
      type: String,
      enum: ['gifting', 'product', 'coming_soon', 'custom'],
      default: 'custom',
    },
    /** Matches gifting page ?occasion= and API giftOccasion (gift category name). */
    giftingOccasion: { type: String, trim: true, maxlength: 80 },
    /** Matches gifting page ?productCategory= and API category (product catalog category name). */
    giftingProductCategory: { type: String, trim: true, maxlength: 80 },
    /** Optional search term for /gifting?search= */
    giftingSearch: { type: String, trim: true, maxlength: 120 },
    /** Internal path when shopLinkMode is product, e.g. /shop/my-slug */
    directProductPath: { type: String, trim: true, maxlength: 280 },
    giftButtonText: { type: String, trim: true, maxlength: 36, default: 'Gifting' },
    giftButtonLink: { type: String, trim: true, maxlength: 240, default: '/gifting' },
    accent: {
      type: String,
      enum: ['rose', 'amber', 'sage'],
      default: 'rose',
    },
  },
  { _id: false }
);

const homeEditorialGalleryTileSchema = new Schema(
  {
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    link: { type: String, trim: true, maxlength: 240 },
    alt: { type: String, trim: true, maxlength: 140 },
  },
  { _id: false },
);

const homeEditorialGallerySchema = new Schema(
  {
    eyebrow: { type: String, trim: true, maxlength: 80 },
    title: { type: String, trim: true, maxlength: 140 },
    subtitle: { type: String, trim: true, maxlength: 260 },
    ctaText: { type: String, trim: true, maxlength: 40 },
    ctaLink: { type: String, trim: true, maxlength: 240 },
    isActive: { type: Boolean, default: true },
    tiles: {
      type: [homeEditorialGalleryTileSchema],
      validate: [
        (arr: unknown[]) => !Array.isArray(arr) || arr.length <= 3,
        "Max 3 editorial gallery tiles",
      ],
    },
  },
  { _id: false },
);

const homeGiftShowcaseSchema = new Schema(
  {
    isActive: { type: Boolean, default: true },
    headlineLine1: { type: String, trim: true, maxlength: 80 },
    headlineLine2: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 520 },
    /** Shown next to social icons, e.g. @thehouseofraniofficial */
    socialHandle: { type: String, trim: true, maxlength: 80 },
    cards: {
      type: [homeGiftShowcaseCardSchema],
      validate: [(arr: unknown[]) => !Array.isArray(arr) || arr.length <= 3, 'Max 3 cards'],
    },
  },
  { _id: false }
);

const homeMiddleBannerSchema = new Schema(
  {
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    title: { type: String, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 120 },
    linkText: { type: String, trim: true, maxlength: 60 },
    linkUrl: { type: String, trim: true },
    textAlignment: { type: String, enum: ['left', 'center', 'right'], default: 'center' },
    textColor: { type: String, enum: ['light', 'dark'], default: 'light' },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const homeExploreHouseSchema = new Schema(
  {
    saleImage: { type: String, trim: true },
    saleImagePublicId: { type: String, trim: true },
    saleName: { type: String, trim: true, maxlength: 48, default: 'Sale' },
    saleSubtitle: { type: String, trim: true, maxlength: 48, default: 'ON OFFER' },
    giftingImage: { type: String, trim: true },
    giftingImagePublicId: { type: String, trim: true },
    giftingName: { type: String, trim: true, maxlength: 48, default: 'Gifting' },
    giftingSubtitle: {
      type: String,
      trim: true,
      maxlength: 48,
      default: 'THE COLLECTION',
    },
  },
  { _id: false },
);

const homePremiumShowcaseSchema = new Schema(
  {
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    preHeading: {
      type: String,
      trim: true,
      maxlength: 60,
      default: 'The Rani Edit',
    },
    heading: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'The Premium Collection',
    },
    text: {
      type: String,
      trim: true,
      maxlength: 500,
      default:
        'Exceptional handwoven sarees — rare silks, masterful zari, and over 200 hours of loom work in every piece. Curated for the discerning few.',
    },
    linkText: {
      type: String,
      trim: true,
      maxlength: 60,
      default: 'Explore Premium',
    },
    linkUrl: { type: String, trim: true, default: '/premium' },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const premiumAudienceBannerSchema = new Schema(
  {
    audience: { type: String, enum: ['all', 'women', 'men', 'kids', 'couple'], required: true },
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    title: { type: String, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 260 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const premiumEditorialSchema = new Schema(
  {
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    preHeading: { type: String, trim: true, maxlength: 60, default: 'The Rani Edit' },
    heading: { type: String, trim: true, maxlength: 120, default: 'CRAFTED FOR THE EXTRAORDINARY' },
    text: { type: String, trim: true, maxlength: 500, default: 'Every piece in the Premium Edit is a testament to time. It takes our master weavers over 200 hours to bring these designs to life. We embrace the perfect imperfections of handloom, creating garments that are not just worn, but inherited.' },
    linkText: { type: String, trim: true, maxlength: 60, default: 'View Collection' }
  },
  { _id: false }
);

const premiumStorySchema = new Schema(
  {
    image: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    heading: { type: String, trim: true, maxlength: 120, default: 'MORE THAN A SAREE' },
    text: { type: String, trim: true, maxlength: 500, default: 'The Premium Collection transcends fashion. It is an archive of technique, an homage to the hands that weave magic into threads. Each drape is a narrative of heritage, reimagined for the modern silhouette.' }
  },
  { _id: false }
);

const premiumFinalCtaSchema = new Schema(
  {
    heading: { type: String, trim: true, maxlength: 120, default: 'DISCOVER THE RANI PREMIUM EDIT' },
    text: { type: String, trim: true, maxlength: 500, default: 'Exceptional pieces, thoughtfully curated for your legacy.' },
    linkText: { type: String, trim: true, maxlength: 60, default: 'Explore Collection' }
  },
  { _id: false }
);

const storefrontSettingsSchema = new Schema(
  {
    key: { type: String, unique: true, default: 'default' },
    announcementMessages: [{ type: String, trim: true, maxlength: 180 }],
    heroSlides: [heroSlideSchema],
    shopBanner: shopBannerSchema,
    promoBanner: promoBannerSchema,
    blogBanner: blogBannerSchema,
    homeMiddleBanner: homeMiddleBannerSchema,
    homePremiumShowcase: { type: homePremiumShowcaseSchema, default: {} },
    homeExploreHouse: homeExploreHouseSchema,
    giftingHeroBanners: [giftingHeroBannerSchema],
    giftingSecondaryBanners: [giftingSecondaryBannerSchema],
    homeGiftShowcase: homeGiftShowcaseSchema,
    homeEditorialGallery: homeEditorialGallerySchema,
    footer: footerSchema,
    premiumAudienceBanners: [premiumAudienceBannerSchema],
    premiumEditorial: { type: premiumEditorialSchema, default: {} },
    premiumStory: { type: premiumStorySchema, default: {} },
    premiumFinalCta: { type: premiumFinalCtaSchema, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model('StorefrontSettings', storefrontSettingsSchema);

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
    categoryLimit: { type: Number, default: 7, min: 1, max: 20 },
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

const storefrontSettingsSchema = new Schema(
  {
    key: { type: String, unique: true, default: 'default' },
    announcementMessages: [{ type: String, trim: true, maxlength: 180 }],
    heroSlides: [heroSlideSchema],
    shopBanner: shopBannerSchema,
    promoBanner: promoBannerSchema,
    blogBanner: blogBannerSchema,
    giftingHeroBanners: [giftingHeroBannerSchema],
    giftingSecondaryBanners: [giftingSecondaryBannerSchema],
    footer: footerSchema,
  },
  { timestamps: true }
);

export default mongoose.model('StorefrontSettings', storefrontSettingsSchema);

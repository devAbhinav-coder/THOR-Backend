import Blog from "../../models/Blog";
import BlogContentPlan from "../../models/BlogContentPlan";
import Product from "../../models/Product";
import { BLOG_CATEGORIES } from "../../types/utils/blogContent";
import {
  getMonthlyTrendSeeds,
  getSeasonLabel,
  getUpcomingFestivals,
} from "./indianFashionTrendCalendar";

export async function buildBlogCalendarContext(input?: {
  weeks?: number;
  focus?: string;
}): Promise<Record<string, unknown>> {
  const weeks = Math.min(12, Math.max(2, input?.weeks ?? 4));
  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setDate(horizonEnd.getDate() + weeks * 7);

  const [publishedBlogs, existingPlans, categoryStats, topProducts] =
    await Promise.all([
      Blog.find({ isPublished: true })
        .select("title category tags createdAt viewCount")
        .sort("-viewCount")
        .limit(20)
        .lean(),
      BlogContentPlan.find({
        plannedDate: { $gte: now, $lte: horizonEnd },
        status: { $ne: "skipped" },
      })
        .select("topic keywords category plannedDate status")
        .sort("plannedDate")
        .lean(),
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Product.find({ isActive: true })
        .select("name slug category fabric tags")
        .sort("-createdAt")
        .limit(12)
        .lean(),
    ]);

  const coveredTopics = publishedBlogs.map((b) => b.title);
  const plannedTopics = existingPlans.map((p) => p.topic);
  const gapCategories = BLOG_CATEGORIES.filter(
    (cat) => !publishedBlogs.some((b) => (b as { category?: string }).category === cat),
  );

  return {
    brand: "The House of Rani",
    market: "India — women ethnic wear, sarees, bridal, gifting",
    season: getSeasonLabel(now),
    planningHorizonWeeks: weeks,
    focusHint: input?.focus?.trim() || null,
    allowedCategories: [...BLOG_CATEGORIES],
    trendSeeds: getMonthlyTrendSeeds(now),
    upcomingFestivals: getUpcomingFestivals(weeks * 7 + 14, now),
    googleTrendsNote:
      "Use trendSeeds as India search-intent proxy (festivals + seasonal). Official Google Trends API is alpha — these are curated ethnic-wear signals.",
    existingPublishedTopics: coveredTopics.slice(0, 15),
    alreadyPlannedTopics: plannedTopics,
    categoryGaps: gapCategories,
    topShopCategories: categoryStats.map((c) => ({
      category: c._id,
      productCount: c.count,
    })),
    productsToPromote: topProducts.map((p) => ({
      name: p.name,
      slug: p.slug,
      category: p.category,
      fabric: (p as { fabric?: string }).fabric,
      tags: ((p as { tags?: string[] }).tags || []).slice(0, 4),
    })),
    contentRules: [
      "Avoid duplicate topics from existingPublishedTopics and alreadyPlannedTopics",
      "Mix categories: styling, bridal, festive, gifting, fabric-care, trends",
      "Tie at least 40% of topics to upcomingFestivals or trendSeeds",
      "Each topic must be unique and SEO-friendly for Indian Google search",
      "Suggest 3-6 keywords per topic from real search intent",
    ],
  };
}

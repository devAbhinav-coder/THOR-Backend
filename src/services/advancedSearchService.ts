import mongoose from "mongoose";
import Product from "../models/Product";
import { OFFLINE_MANUAL_PRODUCT_TAG } from "../constants/offlineOrder";
import { LISTING_PROJECTION } from "../constants/productListing";
import { getCache, setCache } from "./cacheService";
import { getCachedProductCount } from "./productCountService";
import { getProductCacheVersion } from "./productCacheService";
import { normalizeSearchQuery } from "./productQueryParser";

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
import {
  mergeSearchIntentWithFilters,
  normalizeIntentCategory,
  parseSearchQueryIntent,
  type ParsedSearchIntent,
} from "./searchQueryParser";
import { env } from "../config/env";
import logger from "../types/utils/logger";
import { buildShopCollectionFilter } from "./shopCollectionFilterService";
import { mergeOnSaleFilter } from "../constants/onSaleFilter";

/**
 * Advanced MongoDB search service with fuzzy matching and keyword similarity.
 * Provides typo tolerance, synonym support, and intelligent search ranking.
 */
export class AdvancedSearchService {
  private static instance: AdvancedSearchService;
  private readonly SEARCH_CACHE_TTL = 60; // 1 minute cache for search results
  private readonly AUTocomplete_CACHE_TTL = 30; // 30 seconds cache for autocomplete

  // Indian fashion keywords for similarity matching (102+ keywords)
  private readonly INDIAN_FASHION_KEYWORDS = [
    // Saree types
    "saree",
    "sari",
    "sare",
    "banarasi",
    "kanjivaram",
    "kanchipuram",
    "tussar",
    "tussar silk",
    "chanderi",
    "maheshwari",
    "bandhani",
    "bandhej",
    "ikat",
    "patola",
    "pattu",
    "silk",
    "cotton",
    "georgette",
    "chiffon",
    "crepe",
    "net",
    "organza",
    "linen",
    "khadi",

    // Kurta types
    "kurta",
    "kurti",
    "anarkali",
    "straight",
    "a-line",
    "flared",
    "palazzo",
    "salwar",
    "salwar suit",
    "salwar suits",
    "churidar",
    "patiala",
    "dhoti",
    "pajama",
    "pant",
    "trouser",
    "leggings",

    // Lehenga types
    "lehenga",
    "lehenga choli",
    "bridal lehenga",
    "wedding lehenga",
    "party wear",
    "designer lehenga",
    "heavy lehenga",
    "light lehenga",
    "embroidered",

    // Fabric types
    "silk",
    "pure silk",
    "raw silk",
    "tussar silk",
    "matka silk",
    "mulberry silk",
    "cotton",
    "pure cotton",
    "khadi cotton",
    "handloom cotton",
    "linen",
    "pure linen",
    "georgette",
    "chiffon",
    "crepe",
    "net",
    "organza",
    "velvet",
    "brocade",
    "zari",

    // Embellishments
    "embroidered",
    "embroidery",
    "zari",
    "zardozi",
    "sequins",
    "stones",
    "beads",
    "mirror",
    "mirror work",
    "patch",
    "patch work",
    "print",
    "printed",
    "block print",
    "digital print",
    "hand painted",
    "painted",

    // Colors
    "red",
    "maroon",
    "burgundy",
    "pink",
    "rose",
    "peach",
    "orange",
    "saffron",
    "yellow",
    "gold",
    "green",
    "emerald",
    "blue",
    "navy",
    "royal blue",
    "purple",
    "violet",
    "lavender",
    "black",
    "white",
    "ivory",
    "cream",
    "beige",
    "brown",
    "grey",
    "silver",
    "multicolor",
    "multicoloured",

    // Occasions
    "wedding",
    "bridal",
    "engagement",
    "reception",
    "party",
    "festive",
    "diwali",
    "dussehra",
    "eid",
    "christmas",
    "new year",
    "birthday",
    "anniversary",
    "formal",
    "casual",
    "office",
    "work",
    "daily",
    "everyday",

    // Styles
    "traditional",
    "ethnic",
    "contemporary",
    "modern",
    "fusion",
    "indo-western",
    "classic",
    "vintage",
    "royal",
    "regal",
    "luxury",
    "premium",
    "designer",

    // Patterns
    "floral",
    "geometric",
    "abstract",
    "paisley",
    "buta",
    "buti",
    "border",
    "pallu",
    "pallu design",
    "all over",
    "allover",
  ];

  // Synonym mapping for better search matching
  private readonly SYNONYMS: Record<string, string[]> = {
    saree: ["sari", "sare", "sarees", "saris"],
    kurta: ["kurti", "kurtas", "kurtis"],
    lehenga: ["lehenga choli", "bridal lehenga", "lehengas"],
    silk: ["pure silk", "silk fabric", "silken"],
    cotton: ["pure cotton", "cotton fabric"],
    embroidered: ["embroidery", "embroideries"],
    zari: ["zardozi", "gold work"],
    traditional: ["ethnic", "conventional"],
    modern: ["contemporary", "current"],
    wedding: ["bridal", "marriage", "matrimonial"],
    party: ["celebration", "festive", "function"],
    red: ["maroon", "burgundy", "crimson"],
    blue: ["navy", "royal blue", "azure"],
    green: ["emerald", "forest", "olive"],
  };

  private constructor() {}

  static getInstance(): AdvancedSearchService {
    if (!AdvancedSearchService.instance) {
      AdvancedSearchService.instance = new AdvancedSearchService();
    }
    return AdvancedSearchService.instance;
  }

  /**
   * Generate cache key for search queries.
   */
  private async generateSearchCacheKey(
    params: Record<string, unknown>,
  ): Promise<string> {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${JSON.stringify(params[key])}`)
      .join("&");

    const hash = require("crypto")
      .createHash("md5")
      .update(sortedParams)
      .digest("hex");
    const v = await getProductCacheVersion();
    return `cache:v${v}:search:advanced:${hash}`;
  }

  /**
   * Expand search query with synonyms and similar keywords.
   */
  private expandSearchQuery(query: string): string[] {
    if (!query.trim()) {
      return [];
    }

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 2);
    const expandedQueries: string[] = [query];

    // Add synonym expansions
    for (const word of words) {
      if (this.SYNONYMS[word]) {
        for (const synonym of this.SYNONYMS[word]) {
          const synonymQuery = query.toLowerCase().replace(word, synonym);
          if (!expandedQueries.includes(synonymQuery)) {
            expandedQueries.push(synonymQuery);
          }
        }
      }
    }

    // Add common variations (plural/singular)
    for (const word of words) {
      if (word.endsWith("s") && word.length > 3) {
        const singular = word.slice(0, -1);
        const singularQuery = query.toLowerCase().replace(word, singular);
        if (!expandedQueries.includes(singularQuery)) {
          expandedQueries.push(singularQuery);
        }
      } else if (!word.endsWith("s")) {
        const plural = word + "s";
        const pluralQuery = query.toLowerCase().replace(word, plural);
        if (!expandedQueries.includes(pluralQuery)) {
          expandedQueries.push(pluralQuery);
        }
      }
    }

    return expandedQueries;
  }

  private buildFieldRegexMatch(pattern: RegExp): Record<string, unknown> {
    return {
      $or: [
        { name: { $regex: pattern } },
        { description: { $regex: pattern } },
        { shortDescription: { $regex: pattern } },
        { category: { $regex: pattern } },
        { subcategory: { $regex: pattern } },
        { fabric: { $regex: pattern } },
        { tags: { $regex: pattern } },
      ],
    };
  }

  /**
   * Calculate keyword similarity score between query and product.
   */
  private calculateKeywordSimilarity(
    query: string,
    product: {
      name: string;
      description: string;
      shortDescription?: string;
      tags: string[];
      category: string;
      subcategory?: string;
      fabric: string;
    },
    intentHints?: {
      colors?: string[];
      categories?: string[];
    },
  ): number {
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const productText = [
      product.name.toLowerCase(),
      product.description.toLowerCase(),
      product.shortDescription?.toLowerCase() || "",
      product.category.toLowerCase(),
      product.subcategory?.toLowerCase() || "",
      product.fabric?.toLowerCase() || "",
      ...(product.tags || []).map((tag) => tag.toLowerCase()),
    ].join(" ");

    let score = 0;

    // Exact matches
    for (const word of queryWords) {
      if (productText.includes(word)) {
        score += 3;
      }
    }

    // Tag exact / fuzzy match bonus
    for (const tag of product.tags || []) {
      const tagLower = tag.toLowerCase();
      for (const word of queryWords) {
        if (tagLower === word || tagLower.includes(word)) score += 5;
        else if (this.isSimilar(word, tagLower)) score += 4;
      }
    }

    // Subcategory match bonus
    if (product.subcategory) {
      const subLower = product.subcategory.toLowerCase();
      for (const word of queryWords) {
        if (subLower.includes(word)) score += 4;
      }
      if (queryWords.length > 1 && subLower.includes(query.toLowerCase())) {
        score += 6;
      }
    }

    // Partial matches (fuzzy)
    for (const word of queryWords) {
      for (const keyword of this.INDIAN_FASHION_KEYWORDS) {
        if (this.isSimilar(word, keyword)) {
          if (productText.includes(keyword)) {
            score += 2; // Similar keyword match
          }
        }
      }
    }

    // Synonym matches
    for (const word of queryWords) {
      if (this.SYNONYMS[word]) {
        for (const synonym of this.SYNONYMS[word]) {
          if (productText.includes(synonym)) {
            score += 2; // Synonym match
          }
        }
      }
    }

    if (intentHints?.colors?.length) {
      const productText = [product.name, product.description, ...product.tags].join(" ").toLowerCase();
      const productName = product.name.toLowerCase();
      for (const color of intentHints.colors) {
        const needle = color.toLowerCase();
        if (
          productText.includes(needle) ||
          productName.includes(needle)
        ) {
          score += 20;
        }
      }
    }

    if (intentHints?.categories?.length) {
      const productCategory = product.category?.toLowerCase() ?? "";
      for (const category of intentHints.categories) {
        const normalized = normalizeIntentCategory(category).toLowerCase();
        if (productCategory === normalized) {
          score += 15;
        }
      }
    }

    return score;
  }

  /**
   * Check if two words are similar (fuzzy matching).
   */
  private isSimilar(word1: string, word2: string): boolean {
    if (word1 === word2) return true;

    // Levenshtein distance for short words
    if (word1.length <= 6 || word2.length <= 6) {
      const distance = this.levenshteinDistance(word1, word2);
      return distance <= 2; // Allow 2 character differences for short words
    }

    // For longer words, check for common prefixes/suffixes
    const minLength = Math.min(word1.length, word2.length);
    const commonChars = this.countCommonChars(word1, word2);

    return commonChars >= minLength * 0.7; // 70% similarity
  }

  /**
   * Calculate Levenshtein distance between two strings.
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1)
      .fill(null)
      .map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator, // substitution
        );
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Count common characters between two strings.
   */
  private countCommonChars(a: string, b: string): number {
    const aChars = new Set(a);
    const bChars = new Set(b);
    let common = 0;

    for (const char of aChars) {
      if (bChars.has(char)) common++;
    }

    return common;
  }

  /**
   * Advanced search with fuzzy matching and keyword similarity.
   */
  async searchProducts(options: {
    query?: string;
    filters?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
    categories?: string[];
    subcategories?: string[];
    occasions?: string[];
    colors?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    isFeatured?: boolean;
    onSale?: boolean;
    isActive?: boolean;
    adminScope?: boolean;
    useCache?: boolean;
  }): Promise<{
    products: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    searchMethod: "advanced" | "basic";
    cached: boolean;
    searchIntent?: ParsedSearchIntent;
  }> {
    const {
      query = "",
      filters = {},
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = env.pagination.defaultLimit,
      categories = [],
      subcategories = [],
      occasions = [],
      colors = [],
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
      onSale,
      isActive,
      adminScope = false,
      useCache = true,
    } = options;

    const safeQuery = normalizeSearchQuery(query);
    const intent = parseSearchQueryIntent(safeQuery);
    const merged = mergeSearchIntentWithFilters(intent, {
      colors,
      categories,
      subcategories,
      minPrice,
      maxPrice,
    });
    const effectiveQuery = merged.query;
    const effectiveColors = merged.colors;
    const effectiveCategories = merged.categories;
    const effectiveSubcategories = merged.subcategories;
    const textSearchQuery =
      effectiveColors.length > 0 || effectiveCategories.length > 0 ?
        merged.residualQuery
      : effectiveQuery;
    const effectiveMinPrice = merged.minPrice;
    const effectiveMaxPrice = merged.maxPrice;
    const hasQuery = safeQuery.length > 0;
    const colorBoost =
      merged.colors.length > 0 ? ` ${merged.colors.join(" ")}` : "";
    const subcategoryBoost =
      merged.subcategories.length > 0 ?
        ` ${merged.subcategories.join(" ")}`
      : "";
    const tagBoost =
      merged.tags.length > 0 ? ` ${merged.tags.join(" ")}` : "";
    const searchText =
      `${textSearchQuery}${colorBoost}${subcategoryBoost}${tagBoost}`.trim();

    // Generate cache key
    const cacheKey = await this.generateSearchCacheKey({
      query: safeQuery,
      filters,
      sortBy,
      sortOrder,
      page,
      limit,
      categories: effectiveCategories,
      subcategories: effectiveSubcategories,
      colors,
      minPrice: effectiveMinPrice,
      maxPrice: effectiveMaxPrice,
      minRating,
      isFeatured,
      onSale,
      isActive,
      adminScope,
    });

    // Try cache first
    if (useCache) {
      const cached = await getCache<{
        products: Array<Record<string, unknown>>;
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        searchMethod: "advanced" | "basic";
        searchIntent?: ParsedSearchIntent;
      }>(cacheKey);

      if (cached) {
        return {
          ...cached,
          cached: true,
          searchIntent: hasQuery ? intent : cached.searchIntent,
        };
      }
    }

    let searchMethod: "advanced" | "basic" = "basic";
    let result: {
      products: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };

    if (hasQuery) {
      searchMethod = "advanced";
      result = await this.advancedSearch({
        query: searchText,
        filters,
        sortBy,
        sortOrder,
        page,
        limit,
        categories: effectiveCategories,
        subcategories: effectiveSubcategories,
        occasions,
        colors,
        minPrice: effectiveMinPrice,
        maxPrice: effectiveMaxPrice,
        minRating,
        isFeatured,
        onSale,
        isActive,
        adminScope,
      });
    } else {
      result = await this.basicSearch({
        filters,
        sortBy,
        sortOrder,
        page,
        limit,
        categories: effectiveCategories,
        subcategories: effectiveSubcategories,
        occasions,
        colors,
        minPrice: effectiveMinPrice,
        maxPrice: effectiveMaxPrice,
        minRating,
        isFeatured,
        onSale,
        isActive,
        adminScope,
      });
    }

    const response = {
      ...result,
      searchMethod,
      cached: false,
      searchIntent: hasQuery ? intent : undefined,
    };

    if (useCache) {
      setCache(cacheKey, response, this.SEARCH_CACHE_TTL).catch(() => {});
    }

    return response;
  }

  private buildColorVariantFilter(colors: string[]): Record<string, unknown> | null {
    if (!colors.length) return null;
    return {
      $or: colors.flatMap((color) => {
        const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(escaped, "i");
        return [
          { "variants.color": re },
          { "images.color": re },
          { name: re },
          { tags: re },
        ];
      }),
    };
  }

  private buildColorFilter(colors: string[]): Record<string, unknown> | null {
    if (!colors.length) return null;

    return {
      $or: colors.flatMap((color) => {
        const regexStr = escapeRegExp(color);
        return [
          { "variants.color": { $regex: new RegExp(`^${regexStr}$`, "i") } },
        ];
      }),
    };
  }

  private buildFabricFilter(fabrics: string[]): Record<string, unknown> | null {
    if (!fabrics.length) return null;
    return {
      $or: fabrics.flatMap((fabric) => {
        const escaped = fabric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(escaped, "i");
        return [
          { fabric: re },
          { subcategory: re },
          { tags: re },
        ];
      }),
    };
  }

  /**
   * Advanced search implementation with fuzzy matching.
   */
  private async advancedSearch(options: {
    query: string;
    filters?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
    categories?: string[];
    subcategories?: string[];
    occasions?: string[];
    colors?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    isFeatured?: boolean;
    onSale?: boolean;
    isActive?: boolean;
    adminScope?: boolean;
  }): Promise<{
    products: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      query,
      filters = {},
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = env.pagination.defaultLimit,
      categories = [],
      subcategories = [],
      occasions = [],
      colors = [],
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
      onSale,
      isActive,
      adminScope = false,
    } = options;

    const safeQuery = normalizeSearchQuery(query);

    let baseFilter: Record<string, unknown> =
      adminScope ?
        { category: { $ne: "Gifting" } }
      : {
          isActive: true,
          tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
          category: { $ne: "Gifting" },
        };

    const collectionFilter = await buildShopCollectionFilter(
      categories,
      subcategories,
    );
    if (collectionFilter) {
      Object.assign(baseFilter, collectionFilter);
    }

    if (occasions.length > 0) {
      baseFilter.occasions = { $in: occasions };
    }

    const priceFilter: Record<string, unknown> = {};
    if (minPrice !== undefined) {
      priceFilter.$gte = minPrice;
    }
    if (maxPrice !== undefined) {
      priceFilter.$lte = maxPrice;
    }
    if (Object.keys(priceFilter).length > 0) {
      baseFilter.price = priceFilter;
    }

    if (minRating !== undefined) {
      baseFilter["ratings.average"] = { $gte: minRating };
    }

    if (isFeatured !== undefined) {
      baseFilter.isFeatured = isFeatured;
    }
    if (adminScope && isActive !== undefined) {
      baseFilter.isActive = isActive;
    }

    baseFilter = mergeOnSaleFilter(baseFilter, onSale === true);

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        baseFilter[key] = value;
      }
    });

    const expandedQueries = this.expandSearchQuery(safeQuery);

    const regexPatterns = expandedQueries.map((q) => {
      const words = q.split(/\s+/).filter((w) => w.length >= 2);
      if (words.length === 0) {
        return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }
      const regexStrings = words.map((word) => {
        if (word.length <= 3) return word;
        return `(${word}|${word.slice(0, -1)}|${word}s)`;
      });
      return new RegExp(regexStrings.join(".*"), "i");
    });

    const fuzzyPatternMatches = regexPatterns.map((pattern) =>
      this.buildFieldRegexMatch(pattern),
    );

    const wordMatches = safeQuery
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map((word) => {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return this.buildFieldRegexMatch(new RegExp(escaped, "i"));
      });

    const andClauses: Record<string, unknown>[] = [{ ...baseFilter }];
    const colorFilter = this.buildColorVariantFilter(colors);
    if (colorFilter) {
      andClauses.push(colorFilter);
    }
    if (safeQuery.trim()) {
      const regexMatches = [...fuzzyPatternMatches, ...wordMatches];
      if (regexMatches.length > 0) {
        // MongoDB cannot plan $text together with multi-field $regex in $or.
        andClauses.push({ $or: regexMatches });
      }
    }

    const finalFilter =
      andClauses.length === 1 ? andClauses[0]! : { $and: andClauses };

    const skip = (page - 1) * limit;

    const total = await getCachedProductCount(
      finalFilter as Record<string, unknown>,
    );

    const products = await Product.find(finalFilter)
      .sort(this.buildSort(sortBy, sortOrder, safeQuery))
      .skip(skip)
      .limit(limit)
      .select(LISTING_PROJECTION)
      .lean<Array<Record<string, unknown>>>()
      .maxTimeMS(5000);

    // Calculate keyword similarity scores and sort by relevance
    const scoredProducts = products.map((product) => {
      const similarityScore = this.calculateKeywordSimilarity(
        safeQuery,
        {
          name: product.name as string,
          description: product.description as string,
          shortDescription: product.shortDescription as string | undefined,
          tags: product.tags as string[],
          category: product.category as string,
          subcategory: product.subcategory as string | undefined,
          fabric: product.fabric as string,
        },
        {
          categories: categories.length > 0 ? categories : undefined,
        },
      );

      return {
        ...product,
        _relevanceScore: similarityScore,
      };
    });

    // Sort by relevance score (if query exists)
    const sortedProducts =
      safeQuery.trim() ?
        scoredProducts.sort((a, b) => {
          const scoreA = a._relevanceScore as number;
          const scoreB = b._relevanceScore as number;
          return scoreB - scoreA; // Descending by relevance
        })
      : scoredProducts;

    // Remove relevance score from final output
    const finalProducts = sortedProducts.map(
      ({ _relevanceScore, ...rest }) => rest,
    );

    return {
      products: finalProducts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Build sort object with relevance consideration.
   */
  private buildSort(
    sortBy: string,
    sortOrder: "asc" | "desc",
    query: string,
  ): Record<string, 1 | -1 | { $meta: "textScore" }> {
    const sort: Record<string, 1 | -1 | { $meta: "textScore" }> = {};

    if (query.trim() && sortBy === "relevance") {
      sort.isFeatured = -1;
      sort.viewCount = -1;
    } else if (
      sortBy === "price" ||
      sortBy === "ratings.average" ||
      sortBy === "createdAt" ||
      sortBy === "viewCount" ||
      sortBy === "soldCount"
    ) {
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;
      if (sortBy !== "createdAt") {
        sort.createdAt = -1;
      }
    } else {
      sort.createdAt = -1;
    }

    return sort;
  }

  /**
   * Basic search without query (just filtering).
   */
  private async basicSearch(options: {
    filters?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page?: number;
    limit?: number;
    categories?: string[];
    subcategories?: string[];
    occasions?: string[];
    colors?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    isFeatured?: boolean;
    onSale?: boolean;
    isActive?: boolean;
    adminScope?: boolean;
  }): Promise<{
    products: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      filters = {},
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = env.pagination.defaultLimit,
      categories = [],
      subcategories = [],
      occasions = [],
      colors = [],
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
      onSale,
      isActive,
      adminScope = false,
    } = options;

    let baseFilter: Record<string, unknown> =
      adminScope ?
        { category: { $ne: "Gifting" } }
      : {
          isActive: true,
          tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
          category: { $ne: "Gifting" },
        };

    const collectionFilter = await buildShopCollectionFilter(
      categories,
      subcategories,
    );
    if (collectionFilter) {
      Object.assign(baseFilter, collectionFilter);
    }

    if (occasions.length > 0) {
      baseFilter.occasions = { $in: occasions };
    }

    // Apply price range
    const priceFilter: Record<string, unknown> = {};
    if (minPrice !== undefined) {
      priceFilter.$gte = minPrice;
    }
    if (maxPrice !== undefined) {
      priceFilter.$lte = maxPrice;
    }
    if (Object.keys(priceFilter).length > 0) {
      baseFilter.price = priceFilter;
    }

    // Apply rating filter
    if (minRating !== undefined) {
      baseFilter["ratings.average"] = { $gte: minRating };
    }

    // Apply featured filter
    if (isFeatured !== undefined) {
      baseFilter.isFeatured = isFeatured;
    }
    if (adminScope && isActive !== undefined) {
      baseFilter.isActive = isActive;
    }

    baseFilter = mergeOnSaleFilter(baseFilter, onSale === true);

    // Apply additional filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        baseFilter[key] = value;
      }
    });

    const colorFilter = this.buildColorVariantFilter(colors);
    const finalBasicFilter =
      colorFilter ? { $and: [baseFilter, colorFilter] } : baseFilter;

    // Build sort
    const sort = this.buildSort(sortBy, sortOrder, "");

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute query
    const [products, total] = await Promise.all([
      Product.find(finalBasicFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select(LISTING_PROJECTION)
        .lean<Array<Record<string, unknown>>>()
        .maxTimeMS(5000),
      getCachedProductCount(finalBasicFilter),
    ]);

    return {
      products,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Autocomplete with fuzzy matching.
   */
  async autocomplete(
    query: string,
    limit = 5,
  ): Promise<{
    suggestions: Array<{
      id: string;
      name: string;
      slug: string;
      image: string;
      price: number;
      category: string;
      relevance: number;
    }>;
    intent: ParsedSearchIntent;
    querySuggestions: string[];
    collectionSuggestions: Array<{
      name: string;
      url: string;
      image?: string;
    }>;
  }> {
    const safeQuery = normalizeSearchQuery(query);
    if (!safeQuery.trim()) {
      return {
        suggestions: [],
        intent: parseSearchQueryIntent(""),
        querySuggestions: [],
        collectionSuggestions: [],
      };
    }

    const intent = parseSearchQueryIntent(safeQuery);
    const merged = mergeSearchIntentWithFilters(intent, {});
    const textSearchQuery =
      merged.colors.length > 0 || merged.categories.length > 0 ?
        merged.residualQuery
      : merged.query;
    const searchText =
      `${textSearchQuery}${merged.colors.length ? ` ${merged.colors.join(" ")}` : ""}`.trim();

    const v = await getProductCacheVersion();
    const cacheKey = `cache:v${v}:autocomplete:${require("crypto").createHash("md5").update(safeQuery).digest("hex")}`;

    const cached = await getCache<{
      suggestions: Array<{
        id: string;
        name: string;
        slug: string;
        image: string;
        price: number;
        category: string;
        relevance: number;
      }>;
      intent: ParsedSearchIntent;
      querySuggestions: string[];
      collectionSuggestions: Array<{ name: string; url: string; image?: string }>;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const expandedQueries = this.expandSearchQuery(searchText);
    const regexPatterns = expandedQueries.map((q) => new RegExp(q, "i"));

    const conditions = regexPatterns.map((pattern) =>
      this.buildFieldRegexMatch(pattern),
    );

    const wordConditions = searchText
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map((word) => {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return this.buildFieldRegexMatch(new RegExp(escaped, "i"));
      });

    const andClauses: Record<string, unknown>[] = [
      {
        isActive: true,
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
        category: { $ne: "Gifting" },
      },
    ];

    const collectionFilter = await buildShopCollectionFilter(
      merged.categories,
      merged.subcategories,
    );
    if (collectionFilter) {
      andClauses.push(collectionFilter);
    }

    const colorFilter = this.buildColorFilter(merged.colors);
    if (colorFilter) {
      andClauses.push(colorFilter);
    }

    const colorVariantFilter = this.buildColorVariantFilter(merged.colors);
    if (colorVariantFilter) {
      andClauses.push(colorVariantFilter);
    }

    if (merged.maxPrice !== undefined || merged.minPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (merged.minPrice !== undefined) priceFilter.$gte = merged.minPrice;
      if (merged.maxPrice !== undefined) priceFilter.$lte = merged.maxPrice;
      andClauses.push({ price: priceFilter });
    }

    const searchOr = [...conditions, ...wordConditions];
    if (searchText.trim() && searchOr.length > 0) {
      andClauses.push({ $or: searchOr });
    }

    const matchFilter =
      andClauses.length === 1 ? andClauses[0]! : { $and: andClauses };

    const products = await Product.find(matchFilter)
      .sort({ isFeatured: -1, viewCount: -1 })
      .limit(limit * 2) // Get more to filter by relevance
      .select("name slug images price category subcategory description tags fabric shortDescription")
      .lean<
        Array<{
          _id: string;
          name: string;
          slug: string;
          images: Array<{ url: string }>;
          price: number;
          category: string;
          subcategory?: string;
          description: string;
          shortDescription?: string;
          tags: string[];
          fabric: string;
        }>
      >()
      .maxTimeMS(3000);

    // Calculate relevance scores
    const scoredProducts = products.map((product) => {
      const relevance = this.calculateKeywordSimilarity(
        searchText,
        {
          name: product.name,
          description: product.description,
          shortDescription: product.shortDescription,
          tags: product.tags,
          category: product.category,
          subcategory: product.subcategory,
          fabric: product.fabric,
        },
        {
          colors: merged.colors.length > 0 ? merged.colors : undefined,
          categories: merged.categories.length > 0 ? merged.categories : undefined,
        },
      );

      return {
        id: product._id.toString(),
        name: product.name,
        slug: product.slug,
        image: product.images.length > 0 ? product.images[0].url : "",
        price: product.price,
        category: product.category,
        relevance,
      };
    });

    // Sort by relevance and take top results
    const topResults = scoredProducts
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    const querySuggestions = this.buildQuerySuggestions(
      safeQuery,
      searchText,
      intent,
    );

    // Fetch collection suggestions
    const collectionSuggestions: Array<{ name: string; url: string; image?: string }> = [];
    const catQuery = new RegExp(safeQuery, "i");
    
    // Check categories
    const matchedCategories = await mongoose.model("Category").find({ name: catQuery, isActive: true }).limit(2).lean() as any[];
    for (const cat of matchedCategories) {
      collectionSuggestions.push({
        name: cat.name,
        url: `/shop/collections/${cat.slug}`,
        image: cat.image,
      });
    }

    // Check subcategories
    const matchedSubcategories = await mongoose.model("SubCategory").find({ name: catQuery, isActive: true }).limit(3).lean() as any[];
    for (const sub of matchedSubcategories) {
      collectionSuggestions.push({
        name: sub.name,
        url: `/shop/collections/${sub.categorySlug}/${sub.slug}`,
      });
    }

    const payload = {
      suggestions: topResults,
      intent,
      querySuggestions,
      collectionSuggestions,
    };

    setCache(cacheKey, payload, this.AUTocomplete_CACHE_TTL).catch(() => {});

    return payload;
  }

  /**
   * Get search suggestions for zero-result queries.
   */
  async getSearchSuggestions(query: string): Promise<string[]> {
    const safeQuery = normalizeSearchQuery(query);
    if (!safeQuery.trim()) return [];
    const intent = parseSearchQueryIntent(safeQuery);
    return this.buildQuerySuggestions(
      safeQuery,
      intent.textQuery || safeQuery,
      intent,
    );
  }

  private getSearchSuggestionsSync(query: string): string[] {
    const safeQuery = normalizeSearchQuery(query);
    if (!safeQuery.trim()) return [];
    const intent = parseSearchQueryIntent(safeQuery);
    return this.buildQuerySuggestions(safeQuery, query, intent);
  }

  private dedupeQuerySuggestions(items: string[]): string[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildQuerySuggestions(
    safeQuery: string,
    searchText: string,
    intent: ParsedSearchIntent,
  ): string[] {
    const suggestions: string[] = [];

    if (
      intent.textQuery &&
      intent.textQuery.trim().toLowerCase() !== safeQuery.trim().toLowerCase()
    ) {
      suggestions.push(intent.textQuery.trim());
    }

    if (intent.colors.length && intent.categories.length) {
      suggestions.push(`${intent.colors[0]} ${intent.categories[0]}`);
    }

    if (intent.maxPrice !== undefined) {
      const base = intent.textQuery || intent.categories[0] || "saree";
      suggestions.push(`${base} under ${intent.maxPrice}`);
    }

    if (intent.minPrice !== undefined) {
      const base = intent.textQuery || intent.categories[0] || "saree";
      suggestions.push(`${base} above ${intent.minPrice}`);
    }

    if (
      intent.displayLabel &&
      intent.displayLabel.trim().toLowerCase() !== safeQuery.trim().toLowerCase()
    ) {
      suggestions.push(
        intent.displayLabel
          .replace(/\s*·\s*/g, " ")
          .replace(/Under\s*₹([\d,]+)/g, "under $1")
          .replace(/Above\s*₹([\d,]+)/g, "above $1")
          .trim(),
      );
    }

    const words = `${safeQuery} ${searchText}`
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 2);

    for (const word of words) {
      for (const keyword of this.INDIAN_FASHION_KEYWORDS) {
        if (this.isSimilar(word, keyword)) {
          suggestions.push(keyword);
        }
      }
    }

    return this.dedupeQuerySuggestions(suggestions).slice(0, 5);
  }

  /**
   * Get trending searches based on view counts.
   */
  async getTrendingSearches(
    limit = 10,
  ): Promise<Array<{ query: string; count: number }>> {
    // In a real implementation, you'd track search queries in a separate collection
    // For now, return popular product categories and fabrics
    const popularCategories = await Product.aggregate([
      {
        $match: {
          isActive: true,
          tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          totalViews: { $sum: "$viewCount" },
        },
      },
      { $sort: { totalViews: -1 } },
      { $limit: limit },
    ]);

    return popularCategories.map((item) => ({
      query: item._id,
      count: item.totalViews,
    }));
  }

  /**
   * Get search health status.
   */
  async getHealthStatus(): Promise<{
    mongodb: boolean;
    cache: boolean;
    indexes: boolean;
  }> {
    // Check MongoDB
    let mongodbStatus = false;
    try {
      await Product.findOne().limit(1);
      mongodbStatus = true;
    } catch (error) {
      logger.error(
        `MongoDB health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // Check cache (Redis)
    let cacheStatus = false;
    try {
      const testKey = "health:test";
      await setCache(testKey, "test", 1);
      const value = await getCache<string>(testKey);
      cacheStatus = value === "test";
    } catch (error) {
      logger.error(
        `Cache health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // Check text search indexes
    let indexesStatus = false;
    try {
      const indexes = await Product.collection.indexes();
      const hasTextIndex = indexes.some((index) => "text" in index.key);
      indexesStatus = hasTextIndex;
    } catch (error) {
      logger.error(
        `Index health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return {
      mongodb: mongodbStatus,
      cache: cacheStatus,
      indexes: indexesStatus,
    };
  }
}

// Export singleton instance
export const advancedSearchService = AdvancedSearchService.getInstance();

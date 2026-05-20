import Product from '../models/Product';
import { OFFLINE_MANUAL_PRODUCT_TAG } from '../constants/offlineOrder';
import { LISTING_PROJECTION } from '../constants/productListing';
import { getCache, setCache } from './cacheService';
import { getCachedProductCount } from './productCountService';
import { getProductCacheVersion } from './productCacheService';
import { normalizeSearchQuery } from './productQueryParser';
import { env } from '../config/env';
import logger from '../utils/logger';

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
    'saree', 'sari', 'sare', 'banarasi', 'kanjivaram', 'kanchipuram', 'tussar', 'tussar silk',
    'chanderi', 'maheshwari', 'bandhani', 'bandhej', 'ikat', 'patola', 'pattu', 'silk',
    'cotton', 'georgette', 'chiffon', 'crepe', 'net', 'organza', 'linen', 'khadi',
    
    // Kurta types
    'kurta', 'kurti', 'anarkali', 'straight', 'a-line', 'flared', 'palazzo', 'salwar',
    'churidar', 'patiala', 'dhoti', 'pajama', 'pant', 'trouser', 'leggings',
    
    // Lehenga types
    'lehenga', 'lehenga choli', 'bridal lehenga', 'wedding lehenga', 'party wear',
    'designer lehenga', 'heavy lehenga', 'light lehenga', 'embroidered',
    
    // Fabric types
    'silk', 'pure silk', 'raw silk', 'tussar silk', 'matka silk', 'mulberry silk',
    'cotton', 'pure cotton', 'khadi cotton', 'handloom cotton', 'linen', 'pure linen',
    'georgette', 'chiffon', 'crepe', 'net', 'organza', 'velvet', 'brocade', 'zari',
    
    // Embellishments
    'embroidered', 'embroidery', 'zari', 'zardozi', 'sequins', 'stones', 'beads',
    'mirror', 'mirror work', 'patch', 'patch work', 'print', 'printed', 'block print',
    'digital print', 'hand painted', 'painted',
    
    // Colors
    'red', 'maroon', 'burgundy', 'pink', 'rose', 'peach', 'orange', 'saffron',
    'yellow', 'gold', 'green', 'emerald', 'blue', 'navy', 'royal blue', 'purple',
    'violet', 'lavender', 'black', 'white', 'ivory', 'cream', 'beige', 'brown',
    'grey', 'silver', 'multicolor', 'multicoloured',
    
    // Occasions
    'wedding', 'bridal', 'engagement', 'reception', 'party', 'festive', 'diwali',
    'dussehra', 'eid', 'christmas', 'new year', 'birthday', 'anniversary',
    'formal', 'casual', 'office', 'work', 'daily', 'everyday',
    
    // Styles
    'traditional', 'ethnic', 'contemporary', 'modern', 'fusion', 'indo-western',
    'classic', 'vintage', 'royal', 'regal', 'luxury', 'premium', 'designer',
    
    // Patterns
    'floral', 'geometric', 'abstract', 'paisley', 'buta', 'buti', 'border',
    'pallu', 'pallu design', 'all over', 'allover',
  ];

  // Synonym mapping for better search matching
  private readonly SYNONYMS: Record<string, string[]> = {
    'saree': ['sari', 'sare', 'sarees', 'saris'],
    'kurta': ['kurti', 'kurtas', 'kurtis'],
    'lehenga': ['lehenga choli', 'bridal lehenga', 'lehengas'],
    'silk': ['pure silk', 'silk fabric', 'silken'],
    'cotton': ['pure cotton', 'cotton fabric'],
    'embroidered': ['embroidery', 'embroideries'],
    'zari': ['zardozi', 'gold work'],
    'traditional': ['ethnic', 'conventional'],
    'modern': ['contemporary', 'current'],
    'wedding': ['bridal', 'marriage', 'matrimonial'],
    'party': ['celebration', 'festive', 'function'],
    'red': ['maroon', 'burgundy', 'crimson'],
    'blue': ['navy', 'royal blue', 'azure'],
    'green': ['emerald', 'forest', 'olive'],
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
  private async generateSearchCacheKey(params: Record<string, unknown>): Promise<string> {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${JSON.stringify(params[key])}`)
      .join('&');
    
    const hash = require('crypto').createHash('md5').update(sortedParams).digest('hex');
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

    const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
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
      if (word.endsWith('s') && word.length > 3) {
        const singular = word.slice(0, -1);
        const singularQuery = query.toLowerCase().replace(word, singular);
        if (!expandedQueries.includes(singularQuery)) {
          expandedQueries.push(singularQuery);
        }
      } else if (!word.endsWith('s')) {
        const plural = word + 's';
        const pluralQuery = query.toLowerCase().replace(word, plural);
        if (!expandedQueries.includes(pluralQuery)) {
          expandedQueries.push(pluralQuery);
        }
      }
    }

    return expandedQueries;
  }

  /**
   * Calculate keyword similarity score between query and product.
   */
  private calculateKeywordSimilarity(query: string, product: {
    name: string;
    description: string;
    tags: string[];
    category: string;
    fabric: string;
  }): number {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const productText = [
      product.name.toLowerCase(),
      product.description.toLowerCase(),
      product.category.toLowerCase(),
      product.fabric?.toLowerCase() || '',
      ...(product.tags || []).map(tag => tag.toLowerCase()),
    ].join(' ');

    let score = 0;
    
    // Exact matches
    for (const word of queryWords) {
      if (productText.includes(word)) {
        score += 3; // Exact match bonus
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
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
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
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    categories?: string[];
    fabrics?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    isFeatured?: boolean;
    isActive?: boolean;
    adminScope?: boolean;
    useCache?: boolean;
  }): Promise<{
    products: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    searchMethod: 'advanced' | 'basic';
    cached: boolean;
  }> {
    const {
      query = '',
      filters = {},
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = env.pagination.defaultLimit,
      categories = [],
      fabrics = [],
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
      isActive,
      adminScope = false,
      useCache = true,
    } = options;

    const safeQuery = normalizeSearchQuery(query);

    // Generate cache key
    const cacheKey = await this.generateSearchCacheKey({
      query: safeQuery,
      filters,
      sortBy,
      sortOrder,
      page,
      limit,
      categories,
      fabrics,
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
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
        searchMethod: 'advanced' | 'basic';
      }>(cacheKey);

      if (cached) {
        return {
          ...cached,
          cached: true,
        };
      }
    }

    const hasQuery = safeQuery.length > 0;
    let searchMethod: 'advanced' | 'basic' = 'basic';
    let result: {
      products: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };

    if (hasQuery) {
      // Use advanced search with fuzzy matching
      searchMethod = 'advanced';
      result = await this.advancedSearch({
        query: safeQuery,
        filters,
        sortBy,
        sortOrder,
        page,
        limit,
        categories,
        fabrics,
        minPrice,
        maxPrice,
        minRating,
        isFeatured,
        isActive,
        adminScope,
      });
    } else {
      // Use basic filtered search
      result = await this.basicSearch({
        filters,
        sortBy,
        sortOrder,
        page,
        limit,
        categories,
        fabrics,
        minPrice,
        maxPrice,
        minRating,
        isFeatured,
        isActive,
        adminScope,
      });
    }

    const response = {
      ...result,
      searchMethod,
      cached: false,
    };

    // Cache the result
    if (useCache) {
      setCache(cacheKey, response, this.SEARCH_CACHE_TTL).catch(() => {});
    }

    return response;
  }

  /**
   * Advanced search implementation with fuzzy matching.
   */
  private async advancedSearch(options: {
    query: string;
    filters?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    categories?: string[];
    fabrics?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    isFeatured?: boolean;
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
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = env.pagination.defaultLimit,
      categories = [],
      fabrics = [],
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
      isActive,
      adminScope = false,
    } = options;

    const safeQuery = normalizeSearchQuery(query);

    const baseFilter: Record<string, unknown> = adminScope ?
      {}
    : {
        isActive: true,
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
        category: { $ne: "Gifting" },
      };

    if (categories.length > 0) {
      baseFilter.category = { $in: categories };
    }

    if (fabrics.length > 0) {
      baseFilter.fabric = { $in: fabrics };
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

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        baseFilter[key] = value;
      }
    });

    const expandedQueries = this.expandSearchQuery(safeQuery);
    
    // Build regex patterns for fuzzy matching
    const regexPatterns = expandedQueries.map(q => {
      const words = q.split(/\s+/).filter(w => w.length > 2);
      const regexStrings = words.map(word => {
        // Create fuzzy regex pattern
        if (word.length <= 3) {
          return word; // Exact match for short words
        }
        // Allow 1 character difference for longer words
        return `(${word}|${word.slice(0, -1)}|${word}s)`;
      });
      return new RegExp(regexStrings.join('.*'), 'i');
    });

    // Build $or conditions for fuzzy matching
    const orConditions = [
      // Text search on multiple fields
      ...regexPatterns.map(pattern => ({
        $or: [
          { name: { $regex: pattern } },
          { description: { $regex: pattern } },
          { tags: { $regex: pattern } },
          { category: { $regex: pattern } },
          { fabric: { $regex: pattern } },
          { shortDescription: { $regex: pattern } },
        ],
      })),
    ];

    const andClauses: Record<string, unknown>[] = [{ ...baseFilter }];
    if (safeQuery.trim()) {
      andClauses.push({ $text: { $search: safeQuery } });
    }
    if (orConditions.length > 0) {
      andClauses.push({ $or: orConditions });
    }

    const finalFilter =
      andClauses.length === 1 ?
        andClauses[0]!
      : { $and: andClauses };

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
    const scoredProducts = products.map(product => {
      const similarityScore = this.calculateKeywordSimilarity(safeQuery, {
        name: product.name as string,
        description: product.description as string,
        tags: product.tags as string[],
        category: product.category as string,
        fabric: product.fabric as string,
      });

      return {
        ...product,
        _relevanceScore: similarityScore,
      };
    });

    // Sort by relevance score (if query exists)
    const sortedProducts = safeQuery.trim()
      ? scoredProducts.sort((a, b) => {
          const scoreA = a._relevanceScore as number;
          const scoreB = b._relevanceScore as number;
          return scoreB - scoreA; // Descending by relevance
        })
      : scoredProducts;

    // Remove relevance score from final output
    const finalProducts = sortedProducts.map(({ _relevanceScore, ...rest }) => rest);

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
  private buildSort(sortBy: string, sortOrder: 'asc' | 'desc', query: string): Record<string, 1 | -1 | { $meta: 'textScore' }> {
    const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = {};

    if (query.trim() && sortBy === 'relevance') {
      // If sorting by relevance and there's a query, use text score
      sort.score = { $meta: 'textScore' };
    } else if (sortBy === 'price' || sortBy === 'ratings.average' || sortBy === 'createdAt' || sortBy === 'viewCount' || sortBy === 'soldCount') {
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      // Default sort by creation date
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
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    categories?: string[];
    fabrics?: string[];
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    isFeatured?: boolean;
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
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = env.pagination.defaultLimit,
      categories = [],
      fabrics = [],
      minPrice,
      maxPrice,
      minRating,
      isFeatured,
      isActive,
      adminScope = false,
    } = options;

    const baseFilter: Record<string, unknown> = adminScope ?
      {}
    : {
        isActive: true,
        tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
        category: { $ne: "Gifting" },
      };

    // Apply category filter
    if (categories.length > 0) {
      baseFilter.category = { $in: categories };
    }

    // Apply fabric filter
    if (fabrics.length > 0) {
      baseFilter.fabric = { $in: fabrics };
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
      baseFilter['ratings.average'] = { $gte: minRating };
    }

    // Apply featured filter
    if (isFeatured !== undefined) {
      baseFilter.isFeatured = isFeatured;
    }
    if (adminScope && isActive !== undefined) {
      baseFilter.isActive = isActive;
    }

    // Apply additional filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        baseFilter[key] = value;
      }
    });

    // Build sort
    const sort = this.buildSort(sortBy, sortOrder, '');

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute query
    const [products, total] = await Promise.all([
      Product.find(baseFilter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select(LISTING_PROJECTION)
        .lean<Array<Record<string, unknown>>>()
        .maxTimeMS(5000),
      getCachedProductCount(baseFilter),
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
  async autocomplete(query: string, limit = 5): Promise<
    Array<{
    id: string;
    name: string;
    slug: string;
    image: string;
    price: number;
    category: string;
    relevance: number;
    }>
  > {
    const safeQuery = normalizeSearchQuery(query);
    if (!safeQuery.trim()) {
      return [];
    }

    const v = await getProductCacheVersion();
    const cacheKey = `cache:v${v}:autocomplete:${require("crypto").createHash("md5").update(safeQuery).digest("hex")}`;
    
    // Try cache first
    const cached = await getCache<Array<{
      id: string;
      name: string;
      slug: string;
      image: string;
      price: number;
      category: string;
      relevance: number;
    }>>(cacheKey);
    
    if (cached) {
      return cached;
    }

    // Expand query for fuzzy matching
    const expandedQueries = this.expandSearchQuery(safeQuery);
    const regexPatterns = expandedQueries.map(q => new RegExp(q, 'i'));

    // Build search conditions
    const conditions = regexPatterns.map(pattern => ({
      $or: [
        { name: { $regex: pattern } },
        { category: { $regex: pattern } },
        { fabric: { $regex: pattern } },
        { tags: { $regex: pattern } },
      ],
    }));

    const products = await Product.find({
      isActive: true,
      tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] },
      $or: conditions,
    })
      .sort({ isFeatured: -1, viewCount: -1 })
      .limit(limit * 2) // Get more to filter by relevance
      .select('name slug images price category description tags fabric')
      .lean<Array<{
        _id: string;
        name: string;
        slug: string;
        images: Array<{ url: string }>;
        price: number;
        category: string;
        description: string;
        tags: string[];
        fabric: string;
      }>>()
      .maxTimeMS(3000);

    // Calculate relevance scores
    const scoredProducts = products.map(product => {
      const relevance = this.calculateKeywordSimilarity(safeQuery, {
        name: product.name,
        description: product.description,
        tags: product.tags,
        category: product.category,
        fabric: product.fabric,
      });

      return {
        id: product._id.toString(),
        name: product.name,
        slug: product.slug,
        image: product.images.length > 0 ? product.images[0].url : '',
        price: product.price,
        category: product.category,
        relevance,
      };
    });

    // Sort by relevance and take top results
    const topResults = scoredProducts
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    // Cache the results
    setCache(cacheKey, topResults, this.AUTocomplete_CACHE_TTL).catch(() => {});

    return topResults;
  }

  /**
   * Get search suggestions for zero-result queries.
   */
  async getSearchSuggestions(query: string): Promise<string[]> {
    const safeQuery = normalizeSearchQuery(query);
    if (!safeQuery.trim()) {
      return [];
    }

    const suggestions = this.INDIAN_FASHION_KEYWORDS
      .filter(keyword => this.isSimilar(safeQuery.toLowerCase(), keyword))
      .slice(0, 5); // Top 5 suggestions

    return suggestions;
  }

  /**
   * Get trending searches based on view counts.
   */
  async getTrendingSearches(limit = 10): Promise<Array<{ query: string; count: number }>> {
    // In a real implementation, you'd track search queries in a separate collection
    // For now, return popular product categories and fabrics
    const popularCategories = await Product.aggregate([
      { $match: { isActive: true, tags: { $nin: [OFFLINE_MANUAL_PRODUCT_TAG] } } },
      { $group: { _id: '$category', count: { $sum: 1 }, totalViews: { $sum: '$viewCount' } } },
      { $sort: { totalViews: -1 } },
      { $limit: limit },
    ]);

    return popularCategories.map(item => ({
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
      logger.error(`MongoDB health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check cache (Redis)
    let cacheStatus = false;
    try {
      const testKey = 'health:test';
      await setCache(testKey, 'test', 1);
      const value = await getCache<string>(testKey);
      cacheStatus = value === 'test';
    } catch (error) {
      logger.error(`Cache health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Check text search indexes
    let indexesStatus = false;
    try {
      const indexes = await Product.collection.indexes();
      const hasTextIndex = indexes.some(index => 'text' in index.key);
      indexesStatus = hasTextIndex;
    } catch (error) {
      logger.error(`Index health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
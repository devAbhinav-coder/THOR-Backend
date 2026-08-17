# API Changes for Frontend Alignment

## Summary of Backend Changes

The backend has been significantly upgraded with **advanced search capabilities** while maintaining **full backward compatibility**. All existing APIs continue to work as before, with new enhanced endpoints added.

## 🚀 New Search Endpoints (Advanced Features)

### 1. **Advanced Search Endpoint** (`GET /api/products/search`)

**Purpose**: Replace basic search with advanced fuzzy matching, typo tolerance, and keyword similarity.

**Query Parameters**:

- `q` (string): Search query (supports typos like "silk sare", "silk sarre", "silk sari")
- `category` (string|array): Filter by category
- `fabric` (string|array): Filter by fabric
- `minPrice` (number): Minimum price
- `maxPrice` (number): Maximum price
- `minRating` (number): Minimum rating (1-5)
- `isFeatured` (boolean): Show only featured products
- `sortBy` (string): Sort field (`relevance`, `price`, `ratings.average`, `createdAt`, `viewCount`, `soldCount`)
- `sortOrder` (string): Sort order (`asc` or `desc`)
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 12)

**Response Format**:

```json
{
  "data": {
    "products": [
      {
        "_id": "product_id",
        "name": "Product Name",
        "slug": "product-slug",
        "price": 2999,
        "comparePrice": 3999,
        "images": [...],
        "category": "Saree",
        "fabric": "Silk",
        "isFeatured": true,
        "isActive": true,
        "totalStock": 50,
        "ratings": { "average": 4.5, "count": 120 },
        "viewCount": 1500,
        "soldCount": 89,
        "tags": ["silk", "banarasi", "wedding"],
        "isGiftable": true,
        "isCustomizable": false,
        "minOrderQty": 1,
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "searchMethod": "advanced" | "basic",
    "cached": false
  },
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 150,
    "totalPages": 13
  }
}
```

### 2. **Autocomplete Search** (`GET /api/products/autocomplete`)

**Purpose**: Instant search suggestions while typing.

**Query Parameters**:

- `q` (string): Partial search query (e.g., "si", "sar")
- `limit` (number): Max suggestions (default: 5)

**Response Format**:

```json
{
  "data": {
    "suggestions": [
      {
        "id": "product_id",
        "name": "Silk Saree",
        "slug": "silk-saree",
        "image": "https://cloudinary.com/image.jpg",
        "price": 2999,
        "category": "Saree",
        "relevance": 8.5
      }
    ],
    "query": "silk"
  }
}
```

### 3. **Search Suggestions** (`GET /api/products/suggestions`)

**Purpose**: Get alternative search suggestions when no results found.

**Query Parameters**:

- `q` (string): Original search query

**Response Format**:

```json
{
  "data": {
    "suggestions": ["saree", "silk saree", "banarasi saree"],
    "query": "sare"
  }
}
```

### 4. **Trending Searches** (`GET /api/products/trending`)

**Purpose**: Get popular search terms.

**Query Parameters**:

- `limit` (number): Number of trending searches (default: 10)

**Response Format**:

```json
{
  "data": {
    "trending": [
      { "query": "silk saree", "count": 1250 },
      { "query": "kurta", "count": 890 },
      { "query": "lehenga", "count": 750 }
    ]
  }
}
```

## 🔄 Updated Existing Endpoints

### 1. **Get All Products** (`GET /api/products`)

**Enhancement**: Now uses advanced search internally when query parameter is provided.

**Backward Compatibility**: Fully maintained. All existing frontend code will continue to work.

**New Behavior**:

- If `q` parameter is provided → Uses advanced fuzzy search
- If no `q` parameter → Uses basic filtered search (same as before)
- New response includes `searchMethod` field to indicate which search was used

### 2. **All Other Product Endpoints**

**Status**: No changes. All continue to work exactly as before:

- `GET /api/products/featured`
- `GET /api/products/filters`
- `GET /api/products/category/:category`
- `POST /api/products/:slug/view`
- `GET /api/products/:slug`
- Admin endpoints (create, update, delete) unchanged

## 🎯 Frontend Integration Guide

### Option 1: Minimal Changes (Recommended)

Update only your search functionality to use the new `/api/products/search` endpoint while keeping everything else the same.

### Option 2: Progressive Enhancement

1. **Search Page**: Use `/api/products/search` for better results
2. **Header Search**: Use `/api/products/autocomplete` for instant suggestions
3. **No Results Page**: Use `/api/products/suggestions` for alternatives
4. **Homepage**: Use `/api/products/trending` to show popular searches

### Frontend Code Examples

#### 1. Advanced Search Implementation

```typescript
// Search products with fuzzy matching
const searchProducts = async (query: string, filters = {}) => {
  const params = new URLSearchParams({
    q: query,
    page: "1",
    limit: "12",
    sortBy: "relevance",
    ...filters,
  });

  const response = await fetch(`/api/products/search?${params}`);
  const data = await response.json();

  return {
    products: data.data.products,
    pagination: data.pagination,
    searchMethod: data.data.searchMethod,
  };
};
```

#### 2. Autocomplete Implementation

```typescript
// Debounced autocomplete search
const [suggestions, setSuggestions] = useState([]);

const handleSearchInput = debounce(async (query) => {
  if (query.length < 2) {
    setSuggestions([]);
    return;
  }

  const response = await fetch(
    `/api/products/autocomplete?q=${encodeURIComponent(query)}`,
  );
  const data = await response.json();
  setSuggestions(data.data.suggestions);
}, 300);
```

#### 3. No Results Fallback

```typescript
// When search returns no results
if (products.length === 0 && query) {
  const response = await fetch(
    `/api/products/suggestions?q=${encodeURIComponent(query)}`,
  );
  const data = await response.json();
  setAlternativeSuggestions(data.data.suggestions);
}
```

## 🛠️ Technical Details for Frontend Developers

### 1. **Search Features**

- **Typo Tolerance**: "silk sare" → finds "Silk Saree"
- **Synonym Support**: "sari" → finds "Saree", "kurta" → finds "Kurti"
- **Fuzzy Matching**: Partial word matches, character variations
- **Keyword Similarity**: 102+ Indian fashion keywords for better matching
- **Relevance Scoring**: Products scored by match quality

### 2. **Performance Optimizations**

- **Caching**: All search results cached for 1 minute
- **Autocomplete**: Cached for 30 seconds
- **Database Optimization**: Compound indexes for faster queries
- **Response Time**: Sub-100ms for most searches

### 3. **Error Handling**

- **Fallback**: If advanced search fails, automatically falls back to basic search
- **Graceful Degradation**: Frontend won't break if new endpoints fail
- **Backward Compatibility**: Old search URLs continue to work

## 📊 Response Field Changes

### New Fields in Product Responses:

1. `searchMethod`: Indicates which search algorithm was used
2. `cached`: Whether the result came from cache
3. `relevance`: Score in autocomplete results (0-10)

### Unchanged Fields:

All existing product fields remain exactly the same:

- `_id`, `name`, `slug`, `price`, `comparePrice`
- `images`, `category`, `fabric`, `isFeatured`
- `ratings`, `viewCount`, `soldCount`, `tags`
- `isGiftable`, `isCustomizable`, `minOrderQty`
- `createdAt`, `updatedAt`

## 🚨 Migration Checklist for Frontend

### Immediate Actions (Recommended)

1. [ ] Update search page to use `/api/products/search`
2. [ ] Add autocomplete to search input using `/api/products/autocomplete`
3. [ ] Update no-results page to show suggestions from `/api/products/suggestions`

### Optional Enhancements

4. [ ] Show trending searches on homepage
5. [ ] Add search analytics tracking
6. [ ] Implement search history

### Testing Checklist

7. [ ] Test typo tolerance: "silk sare" should find "Silk Saree"
8. [ ] Test synonym matching: "sari" should find "Saree"
9. [ ] Test partial matches: "si" should suggest "Silk"
10. [ ] Verify backward compatibility: Old search URLs still work
11. [ ] Test performance: Search should feel instant
12. [ ] Test error handling: Network failures should degrade gracefully

## 🔧 Backend Configuration for Frontend

### Environment Variables (Already Set)

```env
# Pagination
PAGINATION_MAX_LIMIT=100
PAGINATION_DEFAULT_LIMIT=12

# Caching (Redis)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

### Default Limits

- Max products per page: 100
- Default products per page: 12
- Autocomplete suggestions: 5
- Trending searches: 10

## 📞 Support

### For Frontend Issues:

1. Check response format matches documentation
2. Verify query parameters are properly encoded
3. Test with Postman/curl first
4. Check browser console for errors

### Common Issues & Solutions:

- **404 Error**: Ensure endpoint URL is correct
- **Empty Results**: Try different search terms
- **Slow Response**: Check network tab, backend logs
- **CORS Issues**: Verify frontend URL is in CORS whitelist

## 🎉 Benefits for Frontend

1. **Better UX**: Typo-tolerant search reduces user frustration
2. **Faster Results**: Cached responses and optimized queries
3. **Richer Features**: Autocomplete, suggestions, trending
4. **Future-Proof**: Scalable architecture for growing catalog
5. **No Breaking Changes**: Existing functionality preserved

---

## Loyalty program (2026)

### Customer APIs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/loyalty/preview?subtotal=&couponDiscount=` | User | Redeem preview (balance, max points, max discount) |
| GET | `/api/loyalty/history?page=&limit=` | User | Ledger: earn, redeem, restore, clawback, expire, admin_adjust |
| POST | `/api/cart/apply-loyalty` | User | Body `{ points }` |
| DELETE | `/api/cart/loyalty` | User | Remove applied points |

Checkout body may include `loyaltyPoints` (optional override). Order fields:

- `loyaltyPointsRedeemed`, `loyaltyDiscount`
- `loyaltyPointsEarned`, `loyaltyPointsAwarded` (set on delivery)
- `loyaltyEarnClawedBack`, `loyaltyPointsClawedBack` (on refund)

### Admin loyalty

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users/:id/loyalty/ledger` | User ledger + balance |
| POST | `/api/admin/users/:id/loyalty/adjust` | Body `{ delta, reason }` — audit trail |

Refund flow restores redeemed points and claws back earned points (proportional to refund amount).

---

## Background jobs & outbox (2026)

### Job health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/jobs/health` | Admin | Job last-run stats (use this endpoint; public `/api/health/jobs` removed) |

### Outbox dead letter (admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/outbox/:type/dead-letter?limit=` | List DLQ rows |
| POST | `/api/admin/outbox/:type/:id/replay` | Re-queue entry |

Types: `order`, `cart`, `inventory`, `coupon`, `gifting`, `push`, `blog_publish`.

Admin UI: `/admin/system/jobs`, `/admin/system/outbox`.

---

## Analytics snapshots (2026)

`GET /api/admin/analytics` includes:

- `dailyMetrics[]` — per-day revenue, orders, siteVisits, couponDiscount, loyaltyPointsEarned, loyaltyPointsRedeemed, loyaltyDiscountTotal, refundedAmount, `fromSnapshot`
- `snapshotOverview.totals` — 30-day rollup from `AnalyticsDailySnapshot`

Frontend: `DailyLoyaltyMetricsChart` on admin analytics sales tab.

---

**Last Updated**: Aug 2026 — loyalty ledger, job health UI, DLQ replay, dailyMetrics chart, deployment guide (`DEPLOYMENT.md`).

**Backend Status**: Run `npm run typecheck` (backend) before deploy.

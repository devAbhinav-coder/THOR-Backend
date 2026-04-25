import { Query } from 'mongoose';

interface QueryString {
  page?: string;
  sort?: string;
  limit?: string;
  fields?: string;
  search?: string;
  [key: string]: string | undefined;
}

class APIFeatures<T> {
  public query: Query<T[], T>;
  private queryString: QueryString;
  private filterExpr: Record<string, unknown> = {};
  private searchExpr: Record<string, unknown> = {};
  private pageValue = 1;
  private limitValue = 12;

  constructor(query: Query<T[], T>, queryString: QueryString) {
    this.query = query;
    this.queryString = queryString;
  }

  filter(): this {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields', 'search'];
    excludedFields.forEach((el) => delete queryObj[el]);

    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

    this.filterExpr = JSON.parse(queryStr) as Record<string, unknown>;
    this.query = this.query.find(this.filterExpr as Parameters<typeof this.query.find>[0]);
    return this;
  }

  search(fields: string[]): this {
    if (this.queryString.search) {
      // Use advanced MongoDB Text Search for pro-level relevance matching
      this.searchExpr = { $text: { $search: this.queryString.search } };
      this.query = this.query.find(this.searchExpr as Parameters<typeof this.query.find>[0]);
      
      // Project the textScore metadata so we can sort by it
      this.query = this.query.select({ score: { $meta: 'textScore' } });
    }
    return this;
  }

  sort(): this {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else if (this.queryString.search) {
      // If doing a text search and no specific sort is requested, 
      // sort by the most relevant match first.
      this.query = this.query.sort({ score: { $meta: 'textScore' } });
    } else {
      this.query = this.query.sort('-createdAt');
    }
    return this;
  }

  limitFields(): this {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }
    return this;
  }

  paginate(): this {
    const page = parseInt(this.queryString.page || '1', 10);
    const maxLimit = parseInt(process.env.PAGINATION_MAX_LIMIT || '100', 10);
    const defaultLimit = parseInt(process.env.PAGINATION_DEFAULT_LIMIT || '12', 10);
    const requestedLimit = parseInt(this.queryString.limit || String(defaultLimit), 10);
    const limit = Math.min(Math.max(1, requestedLimit), maxLimit);
    const skip = (page - 1) * limit;
    this.pageValue = page;
    this.limitValue = limit;

    this.query = this.query.skip(skip).limit(limit);
    return this;
  }

  getPage(): number {
    return this.pageValue;
  }

  getLimit(): number {
    return this.limitValue;
  }

  getMongoFilter(): Record<string, unknown> {
    return { ...this.filterExpr, ...this.searchExpr };
  }
}

export default APIFeatures;

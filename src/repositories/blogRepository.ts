import Blog from "../models/Blog";

export const blogRepository = {
  findPublishedList(filter: Record<string, unknown>) {
    return Blog.find(filter)
      .populate("author", "name avatar")
      .select("title slug images author isPublished viewCount createdAt");
  },
};

import { Router } from "express";
import {
  getPinterestCatalogFeed,
  getBlogRssFeed,
  getProductsRssFeed,
} from "../controllers/feedController";

const router = Router();

// Public RSS and Catalog feed endpoints
router.get("/pinterest-catalog.xml", getPinterestCatalogFeed);
router.get("/blog-rss.xml", getBlogRssFeed);
router.get("/products-rss.xml", getProductsRssFeed);

export default router;

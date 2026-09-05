import { Router } from "express";
import {
  getPremiumProduct,
  getPremiumProducts,
} from "../controllers/premiumController";

const router = Router();

router.get("/products", getPremiumProducts);
router.get("/products/:slug", getPremiumProduct);

export default router;

import express from "express";
import {
  createContactRequest,
  createDemoRequest,
} from "../controllers/publicLeadController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { noStore } from "../middleware/noStore.js";

const router = express.Router();
router.use(noStore);

const publicLeadRateLimit = createRateLimiter({
  key: "public-leads",
  windowMs: 15 * 60 * 1000,
  max: 20,
});

router.post("/demo-requests", publicLeadRateLimit, createDemoRequest);
router.post("/contact-requests", publicLeadRateLimit, createContactRequest);

export default router;

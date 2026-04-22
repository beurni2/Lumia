import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/creator/me", (_req, res) => {
  res.json({
    id: "c1",
    name: "Alex",
    location: "Brooklyn, NY",
    niche: "Fitness & Lifestyle",
    followers: 11400,
    currency: "USD",
    imageKey: "creator-1",
  });
});

export default router;

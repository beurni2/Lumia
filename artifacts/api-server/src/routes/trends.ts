import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/trends", (_req, res) => {
  res.json({
    briefs: [
      {
        id: "t1",
        title: "Y2K Revival Thrift Haul",
        context: "US Gen-Z · trending sound",
        viralPotential: 92,
        description:
          "A fast-paced thrift flip using the trending audio everyone in NYC is using this week.",
        imageKey: "creator-1",
      },
      {
        id: "t2",
        title: "Hidden Gem: Brooklyn Matcha",
        context: "US lifestyle · aesthetic cafe",
        viralPotential: 85,
        description:
          "Cinematic shots of the new matcha place in Williamsburg, GRWM-style narration.",
        imageKey: "creator-2",
      },
      {
        id: "t3",
        title: "Get Ready With Me: Night Out",
        context: "US Gen-Z · GRWM storytime",
        viralPotential: 78,
        description: "Chatty GRWM talking about the craziest going-out story.",
        imageKey: "creator-3",
      },
    ],
  });
});

export default router;

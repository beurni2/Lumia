import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/videos", (_req, res) => {
  res.json({
    videos: [
      {
        id: "v1",
        title: "Thrift Flip: 90s Cargo Pants",
        status: "Editing",
        viralScore: 87,
        reasoning:
          "87% — matches the fast-cut style your audience loved last week.",
        thumbnailKey: "creator-1",
        script:
          "Hook: You won't believe what I found at the thrift store today...\n\nBody: Watch me turn these baggy 90s cargos into the perfect low-waist fit.\n\nCTA: Follow for the final look!",
        agents: {
          Ideator: "done",
          Director: "done",
          Editor: "active",
          Monetizer: "pending",
        },
      },
      {
        id: "v2",
        title: "Brooklyn Matcha Review",
        status: "Ready",
        viralScore: 94,
        reasoning:
          "94% — high engagement expected on aesthetic cafe content for US Gen-Z.",
        thumbnailKey: "creator-2",
        script:
          "Hook: Is this the best matcha in NYC?\n\nBody: I went to the new hidden cafe in Williamsburg. The aesthetic is 10/10 and the matcha is imported straight from Kyoto.\n\nCTA: Tag who you're taking here!",
        agents: {
          Ideator: "done",
          Director: "done",
          Editor: "done",
          Monetizer: "done",
        },
      },
      {
        id: "v3",
        title: "GRWM: NYFW Edition",
        status: "Ideating",
        viralScore: null,
        reasoning: "Analyzing current trends for New York Fashion Week...",
        thumbnailKey: "creator-3",
        script: "Generating script based on latest NYFW trends...",
        agents: {
          Ideator: "active",
          Director: "pending",
          Editor: "pending",
          Monetizer: "pending",
        },
      },
    ],
  });
});

export default router;

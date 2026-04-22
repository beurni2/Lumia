import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/earnings/summary", (_req, res) => {
  res.json({
    currentMonth: 1850,
    currency: "USD",
    growth: "+15%",
    deals: [
      { id: "d1", brand: "Gymshark", status: "Signed", amount: 750 },
      { id: "d2", brand: "Glossier", status: "Negotiating", amount: 1200 },
      { id: "d3", brand: "Alo Yoga", status: "Paid", amount: 400 },
    ],
    history: [820, 1050, 980, 1320, 1180, 1640, 1850],
  });
});

export default router;

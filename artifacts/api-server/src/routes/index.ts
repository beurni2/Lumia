import { Router, type IRouter } from "express";
import healthRouter from "./health";
import creatorRouter from "./creator";
import trendsRouter from "./trends";
import earningsRouter from "./earnings";
import videosRouter from "./videos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(creatorRouter);
router.use(trendsRouter);
router.use(earningsRouter);
router.use(videosRouter);

export default router;

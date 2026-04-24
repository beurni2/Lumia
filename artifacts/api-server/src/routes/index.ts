import { Router, type IRouter } from "express";
import healthRouter from "./health";
import creatorRouter from "./creator";
import trendsRouter from "./trends";
import earningsRouter from "./earnings";
import videosRouter from "./videos";
import agentsRouter from "./agents";
import publicationsRouter from "./publications";
import meRouter from "./me";
import adminRouter from "./admin";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(creatorRouter);
router.use(trendsRouter);
router.use(earningsRouter);
router.use(videosRouter);
router.use(agentsRouter);
router.use(publicationsRouter);
router.use(meRouter);
router.use(adminRouter);
router.use(webhooksRouter);

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import psychologyRouter from "./psychology";
import assistantRouter from "./assistant";
import stateRouter from "./state";
import documentsRouter from "./documents";
import storageRouter from "./storage";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);

router.use(requireAuth);
router.use(psychologyRouter);
router.use(assistantRouter);
router.use(stateRouter);
router.use(documentsRouter);
router.use(storageRouter);

export default router;

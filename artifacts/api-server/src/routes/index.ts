import { Router, type IRouter } from "express";
import healthRouter from "./health";
import psychologyRouter from "./psychology";
import assistantRouter from "./assistant";

const router: IRouter = Router();

router.use(healthRouter);
router.use(psychologyRouter);
router.use(assistantRouter);

export default router;

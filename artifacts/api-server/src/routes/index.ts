import { Router, type IRouter } from "express";
import healthRouter from "./health";
import psychologyRouter from "./psychology";

const router: IRouter = Router();

router.use(healthRouter);
router.use(psychologyRouter);

export default router;

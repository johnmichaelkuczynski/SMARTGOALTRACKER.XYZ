import { Router, type IRouter } from "express";
import healthRouter from "./health";
import testSecretsRouter from "./testSecrets";
import psychologyRouter from "./psychology";
import assistantRouter from "./assistant";
import stateRouter from "./state";
import documentsRouter from "./documents";
import storageRouter from "./storage";
import voiceRouter from "./voice";
import ocrRouter from "./ocr";
import projectsRouter from "./projects";
import informedRouter from "./informed";
import legalRouter from "./legal";
import accomplishmentsRouter from "./accomplishments";
import tipsRouter from "./tips";
import visitorsRouter from "./visitors";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
if (process.env.NODE_ENV !== "production") {
  router.use(testSecretsRouter);
}

router.use(visitorsRouter);

router.use(requireAuth);
router.use(psychologyRouter);
router.use(assistantRouter);
router.use(stateRouter);
router.use(documentsRouter);
router.use(storageRouter);
router.use(voiceRouter);
router.use(ocrRouter);
router.use(projectsRouter);
router.use(informedRouter);
router.use(legalRouter);
router.use(accomplishmentsRouter);
router.use(tipsRouter);

export default router;

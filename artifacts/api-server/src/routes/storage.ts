import { Router, type IRouter } from "express";
import { RequestUploadUrlBody } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

/** Hand back a short-lived presigned PUT URL so the browser can upload a file directly to object storage. */
router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid upload-url request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, "Failed to create upload URL");
    res.status(500).json({ error: "Couldn't start the upload. Try again." });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ExtractImageTextBody, ExtractImageTextResponse } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const MODEL = "gpt-5.4";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

const OCR_SYSTEM = `You are an OCR engine. The user gives you a single image — usually a screenshot or a photo. Read every piece of legible text in it and return it as plain text.

Rules:
- Output ONLY the text that appears in the image. Do not describe the image, add commentary, headings, or quotation marks.
- Preserve the natural reading order and keep meaningful line breaks (e.g. separate lines, list items, table rows).
- Include numbers, dates, times, names, and labels exactly as shown.
- If the image contains no legible text at all, return an empty string and nothing else.`;

/** Guess a sensible MIME type for the data URL from the stored object's content type. */
function imageMime(contentType: string | undefined): string {
  const t = (contentType ?? "").toLowerCase();
  if (t.startsWith("image/")) return t;
  return "image/png";
}

/** Read the text out of an image the browser just uploaded to object storage. */
router.post("/ocr/extract", async (req, res): Promise<void> => {
  const parsed = ExtractImageTextBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid OCR body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const { objectPath } = parsed.data;

  let buf: Buffer;
  let contentType: string | undefined;
  try {
    const normalized = objectStorage.normalizeObjectEntityPath(objectPath);
    const file = await objectStorage.getObjectEntityFile(normalized);

    // Authorization: a fresh upload has no ACL policy yet, so the first
    // authenticated user to claim it becomes the owner. If a policy already
    // exists and belongs to someone else, refuse — this stops one user from
    // reading another user's stored image by guessing its path.
    const existingPolicy = await getObjectAclPolicy(file);
    if (existingPolicy && existingPolicy.owner !== userId) {
      res.status(403).json({ error: "You don't have access to that image." });
      return;
    }

    const [metadata] = await file.getMetadata();
    contentType = metadata.contentType;
    if (Number(metadata.size ?? 0) > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: "That image is too large. Use one under 15 MB." });
      return;
    }

    const [downloaded] = await file.download();
    buf = downloaded;

    if (!existingPolicy) {
      await objectStorage.trySetObjectEntityAclPolicy(normalized, {
        owner: userId,
        visibility: "private",
      });
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Uploaded image not found in storage." });
      return;
    }
    req.log.error({ err }, "Failed to fetch uploaded image for OCR");
    res.status(500).json({ error: "Couldn't read the uploaded image." });
    return;
  }

  if (buf.length > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: "That image is too large. Use one under 15 MB." });
    return;
  }

  const dataUrl = `data:${imageMime(contentType)};base64,${buf.toString("base64")}`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: OCR_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Read all the text in this image." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const text = (completion.choices[0]?.message?.content ?? "").trim().slice(0, MAX_TEXT_CHARS);
    res.json(ExtractImageTextResponse.parse({ text }));
  } catch (err) {
    req.log.error({ err }, "OCR failed");
    res.status(500).json({ error: "Couldn't read text from that image right now. Try again." });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { createRequire } from "node:module";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, documentsTable } from "@workspace/db";
import { RegisterDocumentBody, DeleteDocumentParams } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const nodeRequire = createRequire(import.meta.url);
const MAX_EXTRACTED_CHARS = 200_000;

/** pdf-parse's package entry runs debug code on import; the lib subpath does not. Load it lazily. */
let pdfParse: ((b: Buffer) => Promise<{ text: string }>) | null = null;
function getPdfParse(): (b: Buffer) => Promise<{ text: string }> {
  if (!pdfParse) {
    pdfParse = nodeRequire("pdf-parse/lib/pdf-parse.js");
  }
  return pdfParse!;
}

let mammoth: { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> } | null = null;
function getMammoth() {
  if (!mammoth) {
    mammoth = nodeRequire("mammoth");
  }
  return mammoth!;
}

/** Pull readable text out of an uploaded file based on its type. Unknown types fall back to UTF-8. */
async function extractText(buf: Buffer, contentType: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  const type = contentType.toLowerCase();
  try {
    if (type.includes("pdf") || lower.endsWith(".pdf")) {
      const result = await getPdfParse()(buf);
      return result.text ?? "";
    }
    if (
      type.includes("officedocument.wordprocessingml") ||
      type.includes("msword") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".doc")
    ) {
      const result = await getMammoth().extractRawText({ buffer: buf });
      return result.value ?? "";
    }
  } catch {
    return "";
  }
  return buf.toString("utf8");
}

/** List the signed-in user's uploaded documents (metadata only, newest first). */
router.get("/documents", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const rows = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.createdAt));

  res.json({
    documents: rows.map((r) => ({
      id: r.id,
      name: r.name,
      contentType: r.contentType,
      size: r.size,
      charCount: r.charCount,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/** Register a file the browser just uploaded: download it, extract text, persist for the assistant. */
router.post("/documents", async (req, res): Promise<void> => {
  const parsed = RegisterDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid register-document body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const { name, contentType, size, objectPath } = parsed.data;

  let buf: Buffer;
  try {
    const normalized = objectStorage.normalizeObjectEntityPath(objectPath);
    const file = await objectStorage.getObjectEntityFile(normalized);
    const [downloaded] = await file.download();
    buf = downloaded;
    await objectStorage.trySetObjectEntityAclPolicy(normalized, {
      owner: userId,
      visibility: "private",
    });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Uploaded file not found in storage." });
      return;
    }
    req.log.error({ err }, "Failed to fetch uploaded document");
    res.status(500).json({ error: "Couldn't read the uploaded file." });
    return;
  }

  const extracted = (await extractText(buf, contentType, name)).slice(0, MAX_EXTRACTED_CHARS);

  const id = nanoid();
  const now = new Date();
  await db.insert(documentsTable).values({
    id,
    userId,
    name,
    contentType,
    objectPath: objectStorage.normalizeObjectEntityPath(objectPath),
    extractedText: extracted,
    size: size ?? buf.length,
    charCount: extracted.length,
    createdAt: now,
  });

  res.status(201).json({
    id,
    name,
    contentType,
    size: size ?? buf.length,
    charCount: extracted.length,
    createdAt: now.toISOString(),
  });
});

/** Delete one of the signed-in user's documents. */
router.delete("/documents/:id", async (req, res): Promise<void> => {
  const parsed = DeleteDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const deleted = await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.id, parsed.data.id), eq(documentsTable.userId, userId)))
    .returning({ id: documentsTable.id });

  res.json({ success: deleted.length > 0 });
});

export default router;

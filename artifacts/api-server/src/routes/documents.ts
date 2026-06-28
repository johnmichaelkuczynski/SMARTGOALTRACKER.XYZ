import { Router, type IRouter } from "express";
import { createRequire } from "node:module";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, documentsTable } from "@workspace/db";
import {
  RegisterDocumentBody,
  DeleteDocumentParams,
  ExtractDocumentTextBody,
  ExtractDocumentTextResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const nodeRequire = createRequire(import.meta.url);
const MAX_EXTRACTED_CHARS = 200_000;
const MAX_DOC_BYTES = 20 * 1024 * 1024;

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

const ALLOWED_EXTS = [".txt", ".md", ".pdf", ".doc", ".docx"];
const ALLOWED_TYPE_HINTS = ["pdf", "wordprocessingml", "msword", "text/", "markdown"];

/** Accept a file only if its extension or MIME type looks like a supported document. */
function isAllowedDoc(name: string, contentType: string): boolean {
  const lower = name.toLowerCase();
  if (ALLOWED_EXTS.some((ext) => lower.endsWith(ext))) return true;
  const type = contentType.toLowerCase();
  return ALLOWED_TYPE_HINTS.some((hint) => type.includes(hint));
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

/** Read the text out of an uploaded document without saving it to the library. */
router.post("/documents/extract", async (req, res): Promise<void> => {
  const parsed = ExtractDocumentTextBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid extract-document body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const { objectPath, name, contentType } = parsed.data;

  if (!isAllowedDoc(name, contentType)) {
    res.status(415).json({ error: "Unsupported file type. Use TXT, Markdown, Word, or PDF." });
    return;
  }

  let buf: Buffer;
  try {
    const normalized = objectStorage.normalizeObjectEntityPath(objectPath);
    const file = await objectStorage.getObjectEntityFile(normalized);

    // Authorization: a fresh upload has no ACL policy yet, so the first
    // authenticated user to claim it becomes the owner. If a policy already
    // exists and belongs to someone else, refuse — this stops one user from
    // reading another user's stored file by guessing its path.
    const existingPolicy = await getObjectAclPolicy(file);
    if (existingPolicy && existingPolicy.owner !== userId) {
      res.status(403).json({ error: "You don't have access to that file." });
      return;
    }

    const [metadata] = await file.getMetadata();
    if (Number(metadata.size ?? 0) > MAX_DOC_BYTES) {
      res.status(413).json({ error: "That file is too large. Use one under 20 MB." });
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
      res.status(404).json({ error: "Uploaded file not found in storage." });
      return;
    }
    req.log.error({ err }, "Failed to fetch uploaded document for extraction");
    res.status(500).json({ error: "Couldn't read the uploaded file." });
    return;
  }

  if (buf.length > MAX_DOC_BYTES) {
    res.status(413).json({ error: "That file is too large. Use one under 20 MB." });
    return;
  }

  try {
    const text = (await extractText(buf, contentType, name)).slice(0, MAX_EXTRACTED_CHARS);
    res.json(ExtractDocumentTextResponse.parse({ text }));
  } catch (err) {
    req.log.error({ err }, "Document text extraction failed");
    res.status(500).json({ error: "Couldn't read text from that file right now. Try again." });
  }
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

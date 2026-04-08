import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import { db, mediaTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  ListMediaForVisitParams,
  ListMediaForVisitResponse,
  UploadMediaParams,
  DeleteMediaParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });
const storageService = new ObjectStorageService();

router.get("/visits/:id/media", async (req, res): Promise<void> => {
  const params = ListMediaForVisitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const media = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.visitId, params.data.id))
    .orderBy(mediaTable.createdAt);
  res.json(ListMediaForVisitResponse.parse(media));
});

router.post(
  "/visits/:id/media",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const params = UploadMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const mediaType = req.body.type as string;
    if (!["image", "voice_note", "interview", "document"].includes(mediaType)) {
      res.status(400).json({ error: "Invalid media type" });
      return;
    }

    const caption = req.body.caption as string | undefined;

    const uploadUrl = await storageService.getObjectEntityUploadURL();
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.mimetype,
        "Content-Length": String(file.size),
      },
      body: file.buffer,
    });

    if (!uploadResponse.ok) {
      res.status(500).json({ error: "Failed to upload file to storage" });
      return;
    }

    const objectPath = storageService.normalizeObjectEntityPath(uploadUrl.split("?")[0]);
    const servingUrl = `/api/storage${objectPath}`;

    const [media] = await db
      .insert(mediaTable)
      .values({
        visitId: params.data.id,
        type: mediaType,
        url: servingUrl,
        filename: file.originalname,
        caption: caption ?? null,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      })
      .returning();

    res.status(201).json(media);
  }
);

router.delete("/media/:id", async (req, res): Promise<void> => {
  const params = DeleteMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(mediaTable)
    .where(eq(mediaTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

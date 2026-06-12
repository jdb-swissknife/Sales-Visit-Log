import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import { db, mediaTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { logEvent } from "../lib/events";
import { processMediaTranscription } from "../lib/transcription";
import {
  ListMediaForVisitParams,
  ListMediaForVisitResponse,
  UploadMediaParams,
  DeleteMediaParams,
  GetMediaTranscriptionParams,
  GetMediaTranscriptionResponse,
  RequestMediaTranscriptionParams,
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

    const isVoice = mediaType === "voice_note" || mediaType === "interview";

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
        transcriptionStatus: isVoice ? "pending" : "none",
      })
      .returning();

    void logEvent({
      type: "media.uploaded",
      entityType: "media",
      entityId: media.id,
      visitId: media.visitId,
      payload: { mediaType, sizeBytes: file.size },
    });

    if (isVoice) {
      // Fire-and-forget: transcribe + AI-structure in the background.
      void processMediaTranscription(media.id, {
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      });
    }

    res.status(201).json(media);
  }
);

router.get("/media/:id/transcription", async (req, res): Promise<void> => {
  const params = GetMediaTranscriptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [media] = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.id, params.data.id));
  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  res.json(GetMediaTranscriptionResponse.parse(media));
});

router.post("/media/:id/transcription", async (req, res): Promise<void> => {
  const params = RequestMediaTranscriptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [media] = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.id, params.data.id));
  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }
  if (media.transcriptionStatus === "processing") {
    res.status(202).json(GetMediaTranscriptionResponse.parse(media));
    return;
  }
  const [updated] = await db
    .update(mediaTable)
    .set({ transcriptionStatus: "pending", transcriptionError: null })
    .where(eq(mediaTable.id, params.data.id))
    .returning();
  void processMediaTranscription(params.data.id);
  res.status(202).json(GetMediaTranscriptionResponse.parse(updated));
});

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

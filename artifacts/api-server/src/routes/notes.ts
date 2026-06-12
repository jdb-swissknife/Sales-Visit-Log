import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, notesTable } from "@workspace/db";
import { logEvent } from "../lib/events";
import {
  ListNotesForVisitParams,
  ListNotesForVisitResponse,
  CreateNoteParams,
  CreateNoteBody,
  UpdateNoteParams,
  UpdateNoteBody,
  UpdateNoteResponse,
  DeleteNoteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/visits/:id/notes", async (req, res): Promise<void> => {
  const params = ListNotesForVisitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const notes = await db
    .select()
    .from(notesTable)
    .where(eq(notesTable.visitId, params.data.id))
    .orderBy(notesTable.createdAt);
  res.json(ListNotesForVisitResponse.parse(notes));
});

router.post("/visits/:id/notes", async (req, res): Promise<void> => {
  const params = CreateNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db
    .insert(notesTable)
    .values({
      visitId: params.data.id,
      type: parsed.data.type,
      content: parsed.data.content ?? null,
      audioUrl: parsed.data.audioUrl ?? null,
      durationSeconds: parsed.data.durationSeconds ?? null,
    })
    .returning();
  void logEvent({
    type: "note.created",
    entityType: "note",
    entityId: note.id,
    visitId: note.visitId,
    payload: { noteType: note.type },
  });
  res.status(201).json(note);
});

router.put("/notes/:id", async (req, res): Promise<void> => {
  const params = UpdateNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db
    .update(notesTable)
    .set({
      type: parsed.data.type,
      content: parsed.data.content ?? null,
      audioUrl: parsed.data.audioUrl ?? null,
      durationSeconds: parsed.data.durationSeconds ?? null,
    })
    .where(eq(notesTable.id, params.data.id))
    .returning();
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.json(UpdateNoteResponse.parse(note));
});

router.delete("/notes/:id", async (req, res): Promise<void> => {
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(notesTable)
    .where(eq(notesTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

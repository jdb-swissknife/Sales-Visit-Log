import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  coachingProfilesTable,
  coachingKnowledgeDocsTable,
} from "@workspace/db";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ProfileIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

const DocIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

const CreateProfileBody = z.object({
  name: z.string().min(1).max(200),
  scopeType: z.enum(["global", "rep", "team"]).default("global"),
  scopeKey: z.string().min(1).max(200).default("default"),
  transcriptInstructions: z.string().max(10000).nullish(),
  coachingInstructions: z.string().max(10000).nullish(),
  enabled: z.boolean().default(true),
});

const UpdateProfileBody = z.object({
  name: z.string().min(1).max(200).optional(),
  scopeType: z.enum(["global", "rep", "team"]).optional(),
  scopeKey: z.string().min(1).max(200).optional(),
  transcriptInstructions: z.string().max(10000).nullish(),
  coachingInstructions: z.string().max(10000).nullish(),
  enabled: z.boolean().optional(),
});

const CreateDocBody = z.object({
  title: z.string().min(1).max(200),
  sourceType: z.string().min(1).max(100),
  methodTag: z.string().max(100).nullish(),
  body: z.string().min(1).max(50000),
  sortOrder: z.number().int().default(100),
  enabled: z.boolean().default(true),
});

const UpdateDocBody = z.object({
  title: z.string().min(1).max(200).optional(),
  sourceType: z.string().min(1).max(100).optional(),
  methodTag: z.string().max(100).nullish(),
  body: z.string().min(1).max(50000).optional(),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

// GET /coaching/profiles — list all profiles (optionally filtered by scopeType)
router.get("/coaching/profiles", async (req, res): Promise<void> => {
  const scopeType =
    typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;

  const query = db
    .select({
      id: coachingProfilesTable.id,
      scopeType: coachingProfilesTable.scopeType,
      scopeKey: coachingProfilesTable.scopeKey,
      name: coachingProfilesTable.name,
      transcriptInstructions: coachingProfilesTable.transcriptInstructions,
      coachingInstructions: coachingProfilesTable.coachingInstructions,
      enabled: coachingProfilesTable.enabled,
      createdAt: coachingProfilesTable.createdAt,
      updatedAt: coachingProfilesTable.updatedAt,
    })
    .from(coachingProfilesTable)
    .orderBy(coachingProfilesTable.id)
    .$dynamic();

  const profiles = scopeType
    ? await query.where(eq(coachingProfilesTable.scopeType, scopeType))
    : await query;

  res.json(profiles);
});

// GET /coaching/profiles/:id — single profile with its docs
router.get("/coaching/profiles/:id", async (req, res): Promise<void> => {
  const params = ProfileIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [profile] = await db
    .select()
    .from(coachingProfilesTable)
    .where(eq(coachingProfilesTable.id, params.data.id));

  if (!profile) {
    res.status(404).json({ error: "Coaching profile not found" });
    return;
  }

  const docs = await db
    .select()
    .from(coachingKnowledgeDocsTable)
    .where(eq(coachingKnowledgeDocsTable.profileId, params.data.id))
    .orderBy(
      asc(coachingKnowledgeDocsTable.sortOrder),
      asc(coachingKnowledgeDocsTable.id),
    );

  res.json({ ...profile, docs });
});

// POST /coaching/profiles — create profile
router.post("/coaching/profiles", async (req, res): Promise<void> => {
  const parsed = CreateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const [profile] = await db
      .insert(coachingProfilesTable)
      .values({
        name: parsed.data.name,
        scopeType: parsed.data.scopeType,
        scopeKey: parsed.data.scopeKey,
        transcriptInstructions: parsed.data.transcriptInstructions ?? null,
        coachingInstructions: parsed.data.coachingInstructions ?? null,
        enabled: parsed.data.enabled,
      })
      .returning();
    res.status(201).json(profile);
  } catch (err) {
    const errorStr = [
      err instanceof Error ? err.message : String(err),
      err instanceof Error && err.cause instanceof Error ? err.cause.message : "",
      String((err as Record<string, unknown>)?.code ?? ""),
      String((err as Record<string, unknown>)?.cause?.code ?? ""),
    ].join(" ");
    if (errorStr.includes("23505") || errorStr.includes("unique constraint")) {
      res
        .status(409)
        .json({ error: "A profile with this scopeType + scopeKey already exists" });
      return;
    }
    throw err;
  }
});

// PUT /coaching/profiles/:id — update profile
router.put("/coaching/profiles/:id", async (req, res): Promise<void> => {
  const params = ProfileIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const set: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) set.name = parsed.data.name;
  if (parsed.data.scopeType !== undefined) set.scopeType = parsed.data.scopeType;
  if (parsed.data.scopeKey !== undefined) set.scopeKey = parsed.data.scopeKey;
  if (parsed.data.transcriptInstructions !== undefined)
    set.transcriptInstructions = parsed.data.transcriptInstructions;
  if (parsed.data.coachingInstructions !== undefined)
    set.coachingInstructions = parsed.data.coachingInstructions;
  if (parsed.data.enabled !== undefined) set.enabled = parsed.data.enabled;
  set.updatedAt = new Date();

  try {
    const [updated] = await db
      .update(coachingProfilesTable)
      .set(set)
      .where(eq(coachingProfilesTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Coaching profile not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    const errorStr = [
      err instanceof Error ? err.message : String(err),
      err instanceof Error && err.cause instanceof Error ? err.cause.message : "",
      String((err as Record<string, unknown>)?.code ?? ""),
      String((err as Record<string, unknown>)?.cause?.code ?? ""),
    ].join(" ");
    if (errorStr.includes("23505") || errorStr.includes("unique constraint")) {
      res
        .status(409)
        .json({ error: "A profile with this scopeType + scopeKey already exists" });
      return;
    }
    throw err;
  }
});

// DELETE /coaching/profiles/:id — delete profile (cascades to docs)
router.delete("/coaching/profiles/:id", async (req, res): Promise<void> => {
  const params = ProfileIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(coachingProfilesTable)
    .where(eq(coachingProfilesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Coaching profile not found" });
    return;
  }
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Knowledge docs
// ---------------------------------------------------------------------------

// POST /coaching/profiles/:id/docs — add doc to profile
router.post("/coaching/profiles/:id/docs", async (req, res): Promise<void> => {
  const params = ProfileIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateDocBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Verify profile exists
  const [profile] = await db
    .select({ id: coachingProfilesTable.id })
    .from(coachingProfilesTable)
    .where(eq(coachingProfilesTable.id, params.data.id));
  if (!profile) {
    res.status(404).json({ error: "Coaching profile not found" });
    return;
  }

  const [doc] = await db
    .insert(coachingKnowledgeDocsTable)
    .values({
      profileId: params.data.id,
      title: parsed.data.title,
      sourceType: parsed.data.sourceType,
      methodTag: parsed.data.methodTag ?? null,
      body: parsed.data.body,
      sortOrder: parsed.data.sortOrder,
      enabled: parsed.data.enabled,
    })
    .returning();

  res.status(201).json(doc);
});

// PUT /coaching/docs/:id — update doc
router.put("/coaching/docs/:id", async (req, res): Promise<void> => {
  const params = DocIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateDocBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const set: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) set.title = parsed.data.title;
  if (parsed.data.sourceType !== undefined) set.sourceType = parsed.data.sourceType;
  if (parsed.data.methodTag !== undefined) set.methodTag = parsed.data.methodTag;
  if (parsed.data.body !== undefined) set.body = parsed.data.body;
  if (parsed.data.sortOrder !== undefined) set.sortOrder = parsed.data.sortOrder;
  if (parsed.data.enabled !== undefined) set.enabled = parsed.data.enabled;
  set.updatedAt = new Date();

  const [updated] = await db
    .update(coachingKnowledgeDocsTable)
    .set(set)
    .where(eq(coachingKnowledgeDocsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Knowledge doc not found" });
    return;
  }
  res.json(updated);
});

// DELETE /coaching/docs/:id — delete doc
router.delete("/coaching/docs/:id", async (req, res): Promise<void> => {
  const params = DocIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(coachingKnowledgeDocsTable)
    .where(eq(coachingKnowledgeDocsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Knowledge doc not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

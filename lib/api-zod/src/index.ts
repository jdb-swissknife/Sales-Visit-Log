export * from "./generated/api";
export * from "./generated/types";

// These names exist as both zod schemas (generated/api) and generated types.
// Explicit re-export resolves the ambiguity in favor of the zod schemas,
// which is how consumers use them (e.g. CreateVisitBody.safeParse()).
export {
  CreateBusinessBody,
  CreateNoteBody,
  CreateVisitBody,
  UpdateVisitBody,
  UploadMediaBody,
} from "./generated/api";

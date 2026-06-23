/** Shared types for plaud-sync. */

/** Raw business shape from GET /api/businesses. */
export interface BusinessCtx {
  id: number;
  name: string;
  sector?: string | null;
}

/** Structured visit data extracted from a Plaud transcript. */
export interface StructuredVisit {
  summary: string;
  interestLevel: "hot" | "warm" | "cool" | "cold" | "unknown";
  objections: string[];
  followUpItems: string[];
  contactInfo?: string;
  nextStep?: string;
  businessName?: string;
}

/** Per-rep configuration. */
export interface RepPlaudConfig {
  repId: string;
  /** Filesystem path to the rep's Plaud OAuth token directory. */
  tokenDir: string;
}

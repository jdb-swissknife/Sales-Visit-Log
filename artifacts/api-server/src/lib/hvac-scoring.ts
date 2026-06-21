export type HvacPriorityGrade = "A" | "B" | "C" | "D";

export interface HvacTargetInput {
  address?: string | null;
  zip?: string | null;
  street?: string | null;
  subdivision?: string | null;
  neighborhood?: string | null;
  yearBuilt?: number | string | null;
  lastHvacPermitYear?: number | string | null;
  lastMajorRenovationYear?: number | string | null;
  ownerOccupied?: boolean | string | null;
  livingAreaSqft?: number | string | null;
  amiBand?: string | null;
  utilityProvider?: string | null;
}

export interface HvacScoreOptions {
  currentYear?: number;
}

export interface HvacScoreResult extends HvacTargetInput {
  replacementScore: number;
  priorityGrade: HvacPriorityGrade;
  scoreReasons: string[];
  recommendedPitch: string;
  clusterKey: string;
}

export interface HvacClusterSummary {
  clusterKey: string;
  totalDoors: number;
  priorityDoors: number;
  aDoors: number;
  bDoors: number;
  averageScore: number;
}

const DEFAULT_YEAR = 2026;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function toInt(value: unknown): number | null {
  const text = clean(value).replace(/,/g, "");
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["y", "yes", "true", "1", "owner", "owner occupied", "owner-occupied"].includes(clean(value).toLowerCase());
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function gradeHvacScore(score: number): HvacPriorityGrade {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 45) return "C";
  return "D";
}

function scoreHomeAge(yearBuilt: number | null, currentYear: number): [number, string[]] {
  if (!yearBuilt) return [8, ["Missing year built"]];
  const age = currentYear - yearBuilt;
  if (age >= 18 && age <= 30) return [30, [`Home built ${yearBuilt}, prime original-system replacement window`]];
  if (age >= 31 && age <= 45) return [24, [`Home built ${yearBuilt}, older home likely has replacement need`]];
  if (age >= 12 && age <= 17) return [18, [`Home built ${yearBuilt}, entering replacement planning window`]];
  if (age > 45) return [16, [`Home built ${yearBuilt}, age is high but system may have been replaced already`]];
  return [2, [`Newer home built ${yearBuilt}`]];
}

function scoreHvacPermit(lastHvacPermitYear: number | null, currentYear: number): [number, string[]] {
  if (!lastHvacPermitYear) return [28, ["No recent HVAC permit found"]];
  const age = currentYear - lastHvacPermitYear;
  if (age >= 15) return [28, [`Last HVAC permit appears ${age} years old`]];
  if (age >= 10 && age <= 14) return [18, [`HVAC permit is ${age} years old`]];
  if (age >= 6 && age <= 9) return [6, [`HVAC permit is only ${age} years old`]];
  return [-18, [`Recent HVAC permit in ${lastHvacPermitYear}`]];
}

function scoreSqft(livingAreaSqft: number | null): [number, string[]] {
  if (!livingAreaSqft) return [0, []];
  if (livingAreaSqft >= 2600) return [9, [`Larger home (${livingAreaSqft} sqft) likely higher ticket`]];
  if (livingAreaSqft >= 1800) return [6, [`Mid-size home (${livingAreaSqft} sqft)`]];
  if (livingAreaSqft < 1000) return [-2, [`Small home (${livingAreaSqft} sqft) may be lower ticket`]];
  return [2, []];
}

function scoreRebate(target: HvacTargetInput): [number, string[]] {
  const ami = clean(target.amiBand).toLowerCase().replace(/\s/g, "");
  const utility = clean(target.utilityProvider).toLowerCase();
  let points = 0;
  const reasons: string[] = [];

  if (["<80", "under80", "below80", "low", "low-income"].includes(ami)) {
    points += 15;
    reasons.push("Likely strongest Georgia rebate eligibility band");
  } else if (["80-150", "80to150", "moderate", "moderate-income"].includes(ami)) {
    points += 11;
    reasons.push("Likely moderate-income Georgia rebate eligibility band");
  } else if ([">150", "above150", "high"].includes(ami)) {
    points += 1;
    reasons.push("Rebate eligibility may be limited by income");
  } else {
    points += 4;
    reasons.push("AMI unknown, rebate pre-check needed");
  }

  if (utility.includes("georgia power")) {
    points += 3;
    reasons.push("Georgia Power utility noted");
  }

  return [points, reasons];
}

function scoreOccupancy(target: HvacTargetInput): [number, string[]] {
  if (target.ownerOccupied == null || clean(target.ownerOccupied) === "") return [0, []];
  if (truthy(target.ownerOccupied)) return [8, ["Owner-occupied target"]];
  return [-8, ["Likely rental or absentee-owned"]];
}

export function clusterKeyForTarget(target: HvacTargetInput): string {
  const zip = clean(target.zip) || "unknown zip";
  const label = clean(target.subdivision) || clean(target.neighborhood) || clean(target.street) || "unclustered";
  return `${zip} | ${label}`;
}

export function buildHvacPitch(grade: HvacPriorityGrade): string {
  if (grade === "A") return "Georgia rebate pre-check + aging AC replacement conversation. Knock early in the route.";
  if (grade === "B") return "Ask about AC age and comfort issues, then offer rebate pre-check if timing fits.";
  if (grade === "C") return "Knock only if the street cluster is dense or the rep has time between A/B doors.";
  return "Skip unless the homeowner self-identifies a comfort or system-age issue.";
}

export function scoreHvacTarget(target: HvacTargetInput, options: HvacScoreOptions = {}): HvacScoreResult {
  const currentYear = options.currentYear ?? DEFAULT_YEAR;
  const components: Array<[number, string[]]> = [
    scoreHomeAge(toInt(target.yearBuilt), currentYear),
    scoreHvacPermit(toInt(target.lastHvacPermitYear), currentYear),
    scoreOccupancy(target),
    scoreSqft(toInt(target.livingAreaSqft)),
    scoreRebate(target),
  ];

  let score = 10;
  const reasons: string[] = [];
  for (const [points, componentReasons] of components) {
    score += points;
    reasons.push(...componentReasons);
  }

  const renovationYear = toInt(target.lastMajorRenovationYear);
  if (renovationYear && currentYear - renovationYear <= 8) {
    score -= 6;
    reasons.push(`Recent major renovation in ${renovationYear} may include HVAC work`);
  }

  const replacementScore = clampScore(score);
  const priorityGrade = gradeHvacScore(replacementScore);
  return {
    ...target,
    replacementScore,
    priorityGrade,
    scoreReasons: reasons,
    recommendedPitch: buildHvacPitch(priorityGrade),
    clusterKey: clusterKeyForTarget(target),
  };
}

export function summarizeHvacClusters(targets: HvacScoreResult[]): HvacClusterSummary[] {
  const groups = new Map<string, HvacScoreResult[]>();
  for (const target of targets) {
    const key = target.clusterKey || clusterKeyForTarget(target);
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }

  return Array.from(groups.entries())
    .map(([clusterKey, rows]) => {
      const total = rows.reduce((sum, row) => sum + row.replacementScore, 0);
      return {
        clusterKey,
        totalDoors: rows.length,
        priorityDoors: rows.filter((row) => row.priorityGrade === "A" || row.priorityGrade === "B").length,
        aDoors: rows.filter((row) => row.priorityGrade === "A").length,
        bDoors: rows.filter((row) => row.priorityGrade === "B").length,
        averageScore: rows.length > 0 ? Math.round((total / rows.length) * 10) / 10 : 0,
      };
    })
    .sort((a, b) => b.priorityDoors - a.priorityDoors || b.averageScore - a.averageScore || a.clusterKey.localeCompare(b.clusterKey));
}

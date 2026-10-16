// ─────────────────────────────────────────────────────────────
// Kideos — apply a child's questionnaire answers to a content profile
// (pure code, no AI). Changing answers only re-runs this — instant and free.
//
// Result status:
//   approved        → in the kid's feed
//   pending_review  → hidden until the parent approves it ("Ask me")
//   hidden          → not shown
// ─────────────────────────────────────────────────────────────

import { DIMS, LEVEL_LABELS, type Dim } from "./prefs";
import type { ContentProfile, Severity, ValueFilters } from "./types";

export type VerdictStatus = "approved" | "hidden" | "pending_review";

export interface FilterDecision {
  status: VerdictStatus;
  reason: string; // empty when approved
  flags: string[];
  severity: Severity | null;
}

// Clearly educational videos may go one level higher on these (if the parent allows)
const EDU_BOOST: Dim[] = ["violence", "scary", "substances", "politics"];
// Glamorized versions of these are hidden even at low levels (if the parent allows)
const GLORIFIABLE = ["violence", "substances", "selfHarm", "meanness"] as const;
// Never allowed for anyone under 18, whatever the answers
const HARD_LIMIT: Partial<Record<Dim, number>> = { selfHarm: 2, sexual: 3 };

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

function severityFor(excess: number, level: number): Severity {
  if (level === 4 || excess >= 3) return "high";
  return excess === 2 ? "medium" : "low";
}

function reasonText(dim: Dim, level: number, evidence: string): string {
  return `${LEVEL_LABELS[dim][level]}${evidence ? ` (${evidence})` : ""}`;
}

export function evaluateProfile(
  profile: ContentProfile,
  prefs: ValueFilters,
  valuesViolation?: string | null // from checkValuesRules (religion text / custom rules)
): FilterDecision {
  if (profile.status === "unavailable") {
    return {
      status: "hidden",
      reason: "This video is private, age-restricted or no longer available.",
      flags: ["unavailable"],
      severity: "low",
    };
  }
  if (profile.status === "no_transcript") {
    if (prefs.unknown === "allow") return { status: "approved", reason: "", flags: [], severity: null };
    return {
      status: prefs.unknown === "hide" ? "hidden" : "pending_review",
      reason: "Couldn't check this video — no transcript was available.",
      flags: ["no_transcript"],
      severity: "low",
    };
  }

  const hides: string[] = [];
  const reviews: string[] = [];
  const flags: string[] = [];
  let worst: Severity | null = null;
  const note = (bucket: string[], reason: string, flag: string, sev: Severity) => {
    bucket.push(reason);
    flags.push(flag);
    if (!worst || RANK[sev] > RANK[worst]) worst = sev;
  };

  for (const dim of DIMS) {
    const { level, evidence } = profile.dims[dim];
    const rule = prefs.rules[dim];

    if (level === null) {
      if (prefs.unknown !== "allow") {
        note(prefs.unknown === "hide" ? hides : reviews, `Couldn't tell ${dim} level from the transcript`, `${dim}:unknown`, "low");
      }
      continue;
    }

    const hardLimit = HARD_LIMIT[dim];
    if (hardLimit !== undefined && level > hardLimit) {
      note(hides, reasonText(dim, level, evidence), `${dim}:${level}`, "high");
      continue;
    }

    const framing = (GLORIFIABLE as readonly string[]).includes(dim)
      ? profile.framing[dim as (typeof GLORIFIABLE)[number]]
      : "neutral";
    if (prefs.blockGlorified && framing === "glorified" && level >= 1) {
      note(hides, `Glamorized: ${reasonText(dim, level, evidence)}`, `${dim}:glorified`, "medium");
      continue;
    }

    let max = rule.max;
    if (prefs.educationalBoost && profile.purpose === "educational" && EDU_BOOST.includes(dim)) {
      max = Math.min(4, max + 1);
    }
    const excess = level - max;
    if (excess > 0) {
      note(rule.action === "hide" ? hides : reviews, reasonText(dim, level, evidence), `${dim}:${level}`, severityFor(excess, level));
    }
  }

  if (valuesViolation) note(hides, valuesViolation, "values", "medium");

  if (hides.length) return { status: "hidden", reason: [...hides, ...reviews].join("; "), flags, severity: worst };
  if (reviews.length) return { status: "pending_review", reason: reviews.join("; "), flags, severity: worst };
  return { status: "approved", reason: "", flags: [], severity: null };
}

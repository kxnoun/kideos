// ─────────────────────────────────────────────────────────────
// Kideos — apply a child's filters to a content profile (pure code, no AI)
//
// Profiles are filter-independent, so changing filters only re-runs this —
// instant and free. Religion / custom rules are the one exception (see
// checkValuesRules in aiAnalysis.ts); their result is passed in here.
// ─────────────────────────────────────────────────────────────

import type { ContentProfile, Severity, SexualLevel, ValueFilters } from "./types";

export interface FilterDecision {
  approved: boolean;
  reason: string; // empty when approved
  flags: string[];
  severity: Severity | null;
}

const VIOLENCE = ["none", "cartoon", "mild", "moderate", "graphic"];
const LANGUAGE = ["none", "mild", "strong"];
const SEXUAL = ["none", "innuendo", "suggestive", "explicit"];
const POLITICAL = ["none", "educational", "opinion"];

// Highest profile level each filter setting allows
const MAX_VIOLENCE: Record<string, string> = { none: "none", mild: "mild", moderate: "moderate" };
const MAX_LANGUAGE: Record<string, string> = { none: "none", mild: "mild", anything: "strong" };
const MAX_SEXUAL: Record<string, string> = { none: "none", innuendo: "innuendo" };
const MAX_POLITICAL: Record<string, string> = {
  block_all: "none",
  allow_educational: "educational",
  allow_all: "opinion",
};

const LABELS: Record<string, Record<string, string>> = {
  violence: { cartoon: "Cartoon violence", mild: "Violence", moderate: "Intense violence", graphic: "Graphic violence" },
  language: { mild: "Mild language", strong: "Strong language" },
  sexual: { innuendo: "Sexual innuendo", suggestive: "Suggestive sexual content", explicit: "Explicit sexual content" },
  political: { educational: "Political content", opinion: "Political opinion content" },
};

// Filters saved before the sexual-content setting existed have no value: default by age.
export function effectiveSexualLevel(filters: ValueFilters): SexualLevel {
  if (filters.sexualContent === "none" || filters.sexualContent === "innuendo") return filters.sexualContent;
  return filters.ageGroup >= 13 ? "innuendo" : "none";
}

function severityFor(excess: number, level: string): Severity {
  if (level === "graphic" || level === "explicit" || excess >= 3) return "high";
  return excess === 2 ? "medium" : "low";
}

export function evaluateProfile(
  profile: ContentProfile,
  filters: ValueFilters,
  valuesViolation?: string | null // reason from checkValuesRules, if it found a violation
): FilterDecision {
  if (profile.status === "no_transcript") {
    return {
      approved: false,
      reason: "Couldn't verify — no transcript was available for this video.",
      flags: ["no_transcript"],
      severity: "low",
    };
  }
  if (profile.status === "unavailable") {
    return {
      approved: false,
      reason: "This video is private, age-restricted or no longer available.",
      flags: ["unavailable"],
      severity: "low",
    };
  }

  const checks: Array<[string, string[], string, string]> = [
    ["violence", VIOLENCE, profile.violence, MAX_VIOLENCE[filters.violence] ?? "none"],
    ["language", LANGUAGE, profile.language, MAX_LANGUAGE[filters.language] ?? "none"],
    ["sexual", SEXUAL, profile.sexual, MAX_SEXUAL[effectiveSexualLevel(filters)]],
    ["political", POLITICAL, profile.political, MAX_POLITICAL[filters.political] ?? "none"],
  ];

  const reasons: string[] = [];
  const flags: string[] = [];
  let worst: Severity | null = null;
  const rank = { low: 1, medium: 2, high: 3 };

  for (const [category, scale, level, max] of checks) {
    const excess = scale.indexOf(level) - scale.indexOf(max);
    if (excess <= 0) continue;
    const evidence = profile.evidence[category as keyof ContentProfile["evidence"]];
    reasons.push(`${LABELS[category][level]}${evidence ? ` (${evidence})` : ""}`);
    flags.push(`${category}:${level}`);
    const sev = severityFor(excess, level);
    if (!worst || rank[sev] > rank[worst]) worst = sev;
  }

  if (valuesViolation) {
    reasons.push(valuesViolation);
    flags.push("values");
    if (!worst) worst = "medium";
  }

  if (reasons.length === 0) return { approved: true, reason: "", flags: [], severity: null };
  return { approved: false, reason: reasons.join("; "), flags, severity: worst };
}

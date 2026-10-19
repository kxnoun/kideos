// ─────────────────────────────────────────────────────────────
// Kideos — apply a child's questionnaire answers to a content profile
// (pure code, no AI). Changing answers only re-runs this — instant and free.
//
// Result: approved (in the kid's feed) or hidden. There is no approval queue:
// parents browse Shown / Hidden videos with these reasons and can "Show anyway"
// one video (stored separately as parentDecision on the verdict).
// ─────────────────────────────────────────────────────────────

import { DIMS, LEVEL_LABELS, HOLIDAY_LABELS, VALUE_FLAGS, VALUE_FLAG_LABELS, type Dim } from "./prefs";
import type { ContentProfile, DimRating, Severity, ValueFilters } from "./types";

export type VerdictStatus = "approved" | "hidden";

export interface FilterDecision {
  status: VerdictStatus;
  reason: string; // plain words for the parent; empty when approved
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

const MUSIC_LABELS: Record<string, string> = {
  background: "Background music",
  prominent: "Songs or prominent music",
  music_video: "Music video",
};

function severityFor(excess: number, level: number): Severity {
  if (level === 4 || excess >= 3) return "high";
  return excess === 2 ? "medium" : "low";
}

function found(dim: Dim, level: number, evidence: string): string {
  return `${LEVEL_LABELS[dim][level]}${evidence ? ` (${evidence})` : ""}`;
}

function isOwnFaithOnly(profile: ContentProfile, prefs: ValueFilters): boolean {
  const t = prefs.faith?.tradition;
  return Boolean(t && t !== "other" && profile.religionTraditions.length > 0 && profile.religionTraditions.every((x) => x === t));
}

// Parents' "Too hyper" reports: from this many different families a video counts as overstimulating
export const TOO_HYPER_REPORTS = 2;

// The profile's ratings, with dimensions an older profile doesn't have yet as 0
// (until reprofileOutdated upgrades it) and parent "Too hyper" reports applied.
export function effectiveDims(profile: ContentProfile): Record<Dim, DimRating> {
  const out = {} as Record<Dim, DimRating>;
  for (const dim of DIMS) out[dim] = profile.dims?.[dim] ?? { level: 0, evidence: "" };
  const reports = profile.tooHyperReports ?? 0;
  if (reports >= TOO_HYPER_REPORTS && (out.stimulation.level ?? 0) < 4) {
    out.stimulation = { level: 4, evidence: `${reports} parents reported it as too hyper` };
  }
  return out;
}

const NOT_MADE_FOR_KIDS = "Not marked “made for kids” by its creator — you chose made-for-kids videos only";

export function evaluateProfile(
  profile: ContentProfile,
  prefs: ValueFilters,
  valuesViolation?: string | null // from checkValuesRules (religion text / custom rules)
): FilterDecision {
  if (profile.status === "unavailable") {
    return {
      status: "hidden",
      reason: "This video is private, no longer available, or its owner doesn't allow it to play in other apps.",
      flags: ["unavailable"],
      severity: "low",
    };
  }
  // YouTube's own label; older profiles without it are left alone until upgraded
  const notForKids = Boolean(prefs.madeForKidsOnly) && profile.madeForKids === false;
  if (profile.status === "no_transcript") {
    if (notForKids) return { status: "hidden", reason: NOT_MADE_FOR_KIDS, flags: ["not_made_for_kids"], severity: "low" };
    if (prefs.unknown === "allow") return { status: "approved", reason: "", flags: [], severity: null };
    return {
      status: "hidden",
      reason: "We couldn't check this video — it has no transcript. (You chose to hide videos we can't check.)",
      flags: ["no_transcript"],
      severity: "low",
    };
  }

  const reasons: string[] = [];
  const flags: string[] = [];
  let worst: Severity | null = null;
  const note = (reason: string, flag: string, sev: Severity) => {
    reasons.push(reason);
    flags.push(flag);
    if (!worst || RANK[sev] > RANK[worst]) worst = sev;
  };

  if (notForKids) note(NOT_MADE_FOR_KIDS, "not_made_for_kids", "low");
  if (prefs.hideShorts && profile.isShort) note("A YouTube Short — you chose no Shorts", "short", "low");

  const dims = effectiveDims(profile);
  for (const dim of DIMS) {
    const { level, evidence } = dims[dim];

    if (level === null) {
      if (prefs.unknown === "hide") note(`Couldn't tell the ${dim} level from the transcript`, `${dim}:unknown`, "low");
      continue;
    }

    // The family's own faith: its religious content is fine (mocking it still counts)
    if (dim === "religion" && level <= 3 && isOwnFaithOnly(profile, prefs)) continue;

    const hardLimit = HARD_LIMIT[dim];
    if (hardLimit !== undefined && level > hardLimit) {
      note(`${found(dim, level, evidence)} — always hidden for kids`, `${dim}:${level}`, "high");
      continue;
    }

    const framing = (GLORIFIABLE as readonly string[]).includes(dim)
      ? profile.framing[dim as (typeof GLORIFIABLE)[number]]
      : "neutral";
    if (prefs.blockGlorified && framing === "glorified" && level >= 1) {
      note(`${found(dim, level, evidence)}, made to look cool or funny — you chose to hide that`, `${dim}:glorified`, "medium");
      continue;
    }

    let max = prefs.rules[dim].max;
    if (prefs.educationalBoost && profile.purpose === "educational" && EDU_BOOST.includes(dim)) {
      max = Math.min(4, max + 1);
    }
    const excess = level - max;
    if (excess > 0) {
      const limit = LEVEL_LABELS[dim][prefs.rules[dim].max] || "none";
      note(`${found(dim, level, evidence)} — your limit: ${limit}`, `${dim}:${level}`, severityFor(excess, level));
    }
  }

  // ── Faith & family values ──
  for (const h of profile.holidays) {
    const rule = prefs.holidays[h.name] ?? "ok";
    if (rule === "ok" || (rule === "incidental" && h.prominence !== "theme")) continue;
    const what = h.prominence === "theme" ? "is what the video is about" : "comes up";
    note(`${HOLIDAY_LABELS[h.name]} ${what} — you chose to hide ${rule === "incidental" ? "videos about it" : "it"}`, `holiday:${h.name}`, "low");
  }

  for (const f of VALUE_FLAGS) {
    if ((prefs.flags[f] ?? "ok") === "hide" && profile.flags[f]) {
      note(`${VALUE_FLAG_LABELS[f]} — you chose to hide this`, `flag:${f}`, "low");
    }
  }

  // Music: best effort — only what captions ("[Music]") and lyrics reveal
  const m = profile.music.level;
  if (prefs.music === "hide" && m && m !== "none") {
    note(`${MUSIC_LABELS[m]} — you chose to hide videos with music`, `music:${m}`, "low");
  }

  const l = profile.lgbtq;
  if (l !== "none" && prefs.lgbtq !== "allow" && (prefs.lgbtq === "hide_all" || l !== "incidental")) {
    const what = l === "incidental" ? "LGBTQ+ people appear" : l === "discussion" ? "LGBTQ+ topics are discussed" : "LGBTQ+ advocacy";
    note(`${what} — you chose to hide this`, `lgbtq:${l}`, "low");
  }

  if (valuesViolation) note(valuesViolation, "values", "medium");

  if (reasons.length) return { status: "hidden", reason: reasons.join("; "), flags, severity: worst };
  return { status: "approved", reason: "", flags: [], severity: null };
}

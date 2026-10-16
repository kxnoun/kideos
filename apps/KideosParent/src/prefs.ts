// ─────────────────────────────────────────────────────────────
// Kideos — parent content preferences (the per-child questionnaire)
//
// Every dimension uses the same 0–4 ladder. The AI's content profile rates each
// video on these ladders; the parent picks the highest level they allow and what
// happens above it ("hide" or "review" = hidden until the parent approves).
//
// Age defaults are a synthesis of Common Sense Media age bands, ESRB E/E10+/T,
// YouTube 9+/13+ tiers and Australian G/PG/M impact levels — a starting point
// the parent edits, not a validated standard.
//
// KEEP IN SYNC with functions/src/prefs.ts (copied — the apps and backend share no package)
// ─────────────────────────────────────────────────────────────

export const DIMS = [
  "violence",
  "scary",
  "language",
  "romance",
  "sexual",
  "substances",
  "dangerous",
  "selfHarm",
  "meanness",
  "consumerism",
  "politics",
  "religion",
  "gambling",
] as const;
export type Dim = (typeof DIMS)[number];

export type OverAction = "hide" | "review";
export interface DimRule {
  max: number; // highest level allowed (0–4)
  action: OverAction; // what happens above it
}

export interface ValueFilters {
  version: 2;
  ageGroup: number;
  sensitivity: "less" | "average" | "more";
  rules: Record<Dim, DimRule>;
  educationalBoost: boolean; // clearly educational videos: violence/scary/substances/politics +1 level
  blockGlorified: boolean; // always hide glamorized violence, substances, self-harm, cruelty
  unknown: "allow" | "review" | "hide"; // when the transcript can't tell (incl. no transcript)
  religiousSensitivity: boolean; // + religion: free-text values check (AI on summary)
  religion: string;
  customRules: string; // free-text rules (AI on summary)
}

// Level labels — used in block reasons (and mirrored in the parent app's questionnaire)
export const LEVEL_LABELS: Record<Dim, string[]> = {
  violence: ["No violence", "Cartoon slapstick", "Game/fantasy combat", "Realistic violence", "Graphic violence"],
  scary: ["Not scary", "Mild suspense", "Spooky/monsters", "Horror themes", "Intense horror"],
  language: ["Clean language", "Insults", "Mild swearing", "Moderate swearing", "Strong swearing"],
  romance: ["No romance", "Crushes", "Dating/kissing", "Romantic focus", "Sexualized romance"],
  sexual: ["No sexual references", "Mild innuendo", "Crude sexual jokes", "Sexual discussion", "Explicit sexual content"],
  substances: ["No substances", "Substances mentioned", "Substances discussed", "Substance use shown", "Glamorized substance use"],
  dangerous: ["No stunts", "Safe/pro stunts", "Risky stunts with warnings", "Copyable risky stunts", "Dangerous how-to"],
  selfHarm: ["None", "Supportive mental-health talk", "Self-harm/suicide discussed", "Detailed self-harm", "Self-harm encouraged"],
  meanness: ["No meanness", "Gentle pranks", "Mean pranks/insults", "Bullying/humiliation", "Cruelty"],
  consumerism: ["No selling", "Brief sponsor mention", "Product promotion", "Unboxing/merch selling", "Constant selling"],
  politics: ["No politics", "Educational civics/history", "News", "Political opinion", "Extreme political content"],
  religion: ["No religion", "Educational religious content", "Worship/devotional content", "Trying to convert viewers", "Mocking religion"],
  gambling: ["No gambling", "", "", "", "Gambling/loot boxes"],
};

// Columns: ages ≤6, 7–9, 10–12, 13–15, 16–17
const AGE_TABLE: Record<Dim, number[]> = {
  violence: [1, 2, 2, 3, 3],
  scary: [0, 1, 2, 3, 3],
  language: [0, 1, 1, 2, 3],
  romance: [1, 1, 2, 2, 3],
  sexual: [0, 0, 1, 1, 2],
  substances: [0, 1, 1, 2, 2],
  dangerous: [0, 1, 1, 2, 2],
  selfHarm: [0, 0, 1, 1, 2],
  meanness: [0, 1, 1, 2, 2],
  consumerism: [1, 1, 2, 2, 3],
  politics: [0, 0, 1, 1, 2],
  religion: [3, 3, 3, 3, 3], // all religious content except mocking
  gambling: [0, 0, 0, 0, 0],
};

function ageColumn(age: number): number {
  if (age <= 6) return 0;
  if (age <= 9) return 1;
  if (age <= 12) return 2;
  if (age <= 15) return 3;
  return 4;
}

export function defaultPrefs(ageGroup: number, sensitivity: ValueFilters["sensitivity"] = "average"): ValueFilters {
  const col = ageColumn(ageGroup);
  const rules = {} as Record<Dim, DimRule>;
  for (const dim of DIMS) rules[dim] = { max: AGE_TABLE[dim][col], action: "hide" };
  const shift = sensitivity === "more" ? -1 : sensitivity === "less" ? 1 : 0;
  rules.scary.max = Math.max(0, Math.min(4, rules.scary.max + shift));
  if (col === 4) rules.gambling.action = "review";
  return {
    version: 2,
    ageGroup,
    sensitivity,
    rules,
    educationalBoost: true,
    blockGlorified: true,
    unknown: "review",
    religiousSensitivity: false,
    religion: "",
    customRules: "",
  };
}

// Accepts v2 prefs or the original (v1) filter format and returns v2.
// v1 → v2: age defaults, overridden by the v1 answers the parent actually gave.
export function normalizePrefs(raw: Record<string, unknown> | undefined, fallbackAge = 7): ValueFilters {
  if (raw && raw.version === 2) {
    const d = defaultPrefs(Number(raw.ageGroup) || fallbackAge);
    const r = raw as unknown as ValueFilters;
    return { ...d, ...r, rules: { ...d.rules, ...(r.rules ?? {}) } };
  }
  const age = Number(raw?.ageGroup) || fallbackAge;
  const p = defaultPrefs(age);
  if (!raw) return p;
  const map = (v: unknown, m: Record<string, number>) => (typeof v === "string" && v in m ? m[v] : undefined);
  const set = (dim: Dim, v: number | undefined) => {
    if (v !== undefined) p.rules[dim].max = v;
  };
  set("violence", map(raw.violence, { none: 0, mild: 2, moderate: 3 }));
  set("language", map(raw.language, { none: 0, mild: 2, anything: 4 }));
  set("sexual", map(raw.sexualContent, { none: 0, innuendo: 1 }));
  set("politics", map(raw.political, { block_all: 0, allow_educational: 1, allow_all: 3 }));
  p.religiousSensitivity = Boolean(raw.religiousSensitivity);
  p.religion = typeof raw.religion === "string" ? raw.religion : "";
  p.customRules = typeof raw.customRules === "string" ? raw.customRules : "";
  return p;
}

// Plain-English summary of the answers, for AI prompts (e.g. channel suggestions)
export function describePrefs(p: ValueFilters): string {
  const lines = DIMS.map((dim) => `- ${dim}: allow up to "${LEVEL_LABELS[dim][p.rules[dim].max] || "none"}"`);
  if (p.religiousSensitivity && p.religion) lines.push(`- Religious values: ${p.religion}`);
  if (p.customRules) lines.push(`- Custom rules: ${p.customRules}`);
  return lines.join("\n");
}

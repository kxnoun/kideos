// ─────────────────────────────────────────────────────────────
// Kideos — parent content preferences (the per-child questionnaire)
//
// Every dimension uses the same 0–4 ladder. The AI's content profile rates each
// video on these ladders; the parent picks the highest level they allow. Anything
// above it is hidden — no approval queue. Parents can browse Shown / Hidden videos
// (with reasons) and "Show anyway" a single video.
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
  "stimulation", // pace & stimulation: calm → overstimulating ("brainrot")
  "junk", // low-effort / spam / Elsagate-style content
  // Advanced (optional section)
  "crudeHumor",
  "matureThemes",
  "misinformation",
  "nudity",
] as const;
export type Dim = (typeof DIMS)[number];

export interface DimRule {
  max: number; // highest level allowed (0–4); anything above is hidden
}

// ── Faith & family values (yes/no-style checks on specific content) ──

export const HOLIDAYS = [
  "christmas",
  "easter",
  "halloween",
  "valentines",
  "diwali",
  "hanukkah",
  "eid",
  "ramadan",
  "passover",
  "lunar_new_year",
] as const;
export type Holiday = (typeof HOLIDAYS)[number];
export const HOLIDAY_LABELS: Record<Holiday, string> = {
  christmas: "Christmas",
  easter: "Easter",
  halloween: "Halloween",
  valentines: "Valentine's Day",
  diwali: "Diwali",
  hanukkah: "Hanukkah",
  eid: "Eid",
  ramadan: "Ramadan",
  passover: "Passover",
  lunar_new_year: "Lunar New Year",
};
// ok | incidental = OK in passing, hidden when it's the video's theme | hide
export type HolidayRule = "ok" | "incidental" | "hide";

export const VALUE_FLAGS = [
  "fantasyMagic",
  "realOccult",
  "prophetDepiction",
  "religiousExclamations",
  "pork",
  "nonKosher",
  "alcoholFood",
  "beef",
  "evolution",
  "matureGames",
] as const;
export type ValueFlag = (typeof VALUE_FLAGS)[number];
export const VALUE_FLAG_LABELS: Record<ValueFlag, string> = {
  fantasyMagic: "Fantasy magic (Harry Potter-style)",
  realOccult: "Real-world occult (tarot, astrology, spells, Ouija)",
  prophetDepiction: "Depictions of prophets",
  religiousExclamations: "God's name as an exclamation (“OMG”, “Jesus Christ!”)",
  pork: "Pork in food content",
  nonKosher: "Non-kosher food (shellfish, meat with dairy)",
  alcoholFood: "Cooking with alcohol",
  beef: "Beef in food content",
  evolution: "Evolution and origins content",
  matureGames: "Mature-rated video games (GTA, Call of Duty, horror games)",
};
export type FlagRule = "ok" | "hide";

export type LgbtqRule = "allow" | "hide_discussion" | "hide_all";
export type Tradition = "" | "islam" | "judaism" | "christianity" | "hinduism" | "sikhism" | "other";

export interface ValueFilters {
  version: 2;
  ageGroup: number;
  sensitivity: "less" | "average" | "more";
  rules: Record<Dim, DimRule>;
  educationalBoost: boolean; // clearly educational videos: violence/scary/substances/politics +1 level
  blockGlorified: boolean; // always hide glamorized violence, substances, self-harm, cruelty
  unknown: "allow" | "hide"; // when the transcript can't tell (incl. no transcript)
  faith: { tradition: Tradition }; // only effect: own faith's religious content is exempt from the religion ladder
  holidays: Record<Holiday, HolidayRule>;
  flags: Record<ValueFlag, FlagRule>;
  music: FlagRule; // best effort: detected from captions ("[Music]") and lyrics only
  lgbtq: LgbtqRule; // allow · hide discussion/advocacy (presence OK) · hide all
  religiousSensitivity: boolean; // + religion: free-text values check (AI on summary)
  religion: string;
  customRules: string; // free-text rules (AI on summary)
  madeForKidsOnly?: boolean; // only videos the creator marked "made for kids" (YouTube's own label)
  gamblingLadder?: boolean; // true once gambling uses the 0–4 ladder (older answers were 0 / 4 only)
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
  gambling: ["No gambling", "Gambling mentioned", "Gambling discussed", "Gambling shown", "Gambling promoted"],
  stimulation: ["Calm", "Gentle", "Lively", "High energy", "Overstimulating"],
  junk: ["Not junk", "Low effort", "Clickbait / knock-off characters", "Spam / nonsense", "Disturbing fake kids' content"],
  crudeHumor: ["No crude humor", "Silly gross-out", "Toilet humor", "Frequent gross-out humor", "Extreme gross-out"],
  matureThemes: ["No mature themes", "Brief mention of death/illness", "Gently handled mature theme", "Heavy themes in depth", "Disturbing mature themes"],
  misinformation: ["No misinformation", "Unverified claims", "Pseudoscience/conspiracy as fact", "Harmful health/safety misinformation", "Extremist conspiracy"],
  nudity: ["No nudity", "Swimwear in normal context", "Revealing clothing as a focus", "Partial nudity", "Nudity"],
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
  gambling: [1, 1, 2, 2, 2], // passing mentions OK; shown/promoted never by default
  stimulation: [2, 3, 3, 4, 4], // little kids: no CoComelon-style overload; nobody: brainrot until 13
  junk: [1, 1, 1, 2, 2], // spam and Elsagate never by default
  crudeHumor: [1, 2, 2, 3, 3],
  matureThemes: [1, 1, 2, 3, 3],
  misinformation: [1, 1, 1, 1, 1],
  nudity: [1, 1, 1, 2, 2],
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
  for (const dim of DIMS) rules[dim] = { max: AGE_TABLE[dim][col] };
  const shift = sensitivity === "more" ? -1 : sensitivity === "less" ? 1 : 0;
  rules.scary.max = Math.max(0, Math.min(4, rules.scary.max + shift));
  rules.matureThemes.max = Math.max(0, Math.min(4, rules.matureThemes.max + shift));
  return {
    version: 2,
    ageGroup,
    sensitivity,
    rules,
    educationalBoost: true,
    blockGlorified: true,
    unknown: "hide",
    faith: { tradition: "" },
    holidays: Object.fromEntries(HOLIDAYS.map((h) => [h, "ok"])) as Record<Holiday, HolidayRule>,
    flags: Object.fromEntries(VALUE_FLAGS.map((f) => [f, "ok"])) as Record<ValueFlag, FlagRule>,
    music: "ok",
    lgbtq: "allow",
    religiousSensitivity: false,
    religion: "",
    customRules: "",
    madeForKidsOnly: false,
    gamblingLadder: true,
  };
}

// Accepts v2 prefs or the original (v1) filter format and returns v2.
// v1 → v2: age defaults, overridden by the v1 answers the parent actually gave.
export function normalizePrefs(raw: Record<string, unknown> | undefined, fallbackAge = 7): ValueFilters {
  if (raw && raw.version === 2) {
    const d = defaultPrefs(Number(raw.ageGroup) || fallbackAge);
    const r = raw as unknown as ValueFilters;
    // Older answers had "review" ("Ask me first") options — those now mean hide.
    const okOrHide = (v: unknown): FlagRule => (v === "ok" || v === "all" ? "ok" : "hide");
    const raw2 = raw as Record<string, any>;
    const rules = { ...d.rules };
    for (const dim of DIMS) {
      const m = raw2.rules?.[dim]?.max;
      if (typeof m === "number") rules[dim] = { max: m };
    }
    // Gambling used to be present/absent: "Not allowed" (0) meant no real gambling,
    // which is "passing mentions OK" (1) on the ladder
    if (!raw2.gamblingLadder && rules.gambling.max === 0) rules.gambling = { max: 1 };
    const flags = { ...d.flags };
    for (const f of VALUE_FLAGS) if (raw2.flags?.[f]) flags[f] = okOrHide(raw2.flags[f]);
    const holidays = { ...d.holidays };
    for (const h of HOLIDAYS) {
      const v = raw2.holidays?.[h];
      if (v) holidays[h] = v === "ok" || v === "incidental" ? v : "hide";
    }
    const lg = raw2.lgbtq;
    return {
      ...d,
      ...r,
      rules,
      faith: { tradition: r.faith?.tradition ?? "" },
      holidays,
      flags,
      unknown: raw2.unknown === "allow" ? "allow" : "hide",
      // earlier music options (all / background / vocals_only / none / review) → ok / hide
      music: raw2.music === undefined ? "ok" : okOrHide(raw2.music),
      lgbtq: lg === "allow" || lg === undefined ? "allow" : lg === "review" || lg === "hide_all" ? "hide_all" : "hide_discussion",
      madeForKidsOnly: Boolean(raw2.madeForKidsOnly),
      gamblingLadder: true,
    };
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

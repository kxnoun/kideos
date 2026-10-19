// ─────────────────────────────────────────────────────────────
// Kideos — AI content analysis via OpenAI GPT-4o-mini
//
// 1. generateContentProfile — describes WHAT is in a video on fixed scales.
//    Filter-independent: run once per video, shared by every family.
// 2. checkValuesRules — the only per-family AI call: judges a profile's short
//    summary (not the transcript) against religion / free-text custom rules.
//
// Whether a video is allowed for a child is decided in code (contentFilter.ts).
// ─────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { createHash } from "crypto";
import { logger } from "firebase-functions/v2";
import { APP_CONFIG } from "./config";
import type { ContentProfile, DimRating, Framing, PaceStats, ValueFilters } from "./types";
import { DIMS, HOLIDAYS, VALUE_FLAGS, type Dim, type Holiday } from "./prefs";
import type { YouTubeVideoDetails } from "./youtube";

// Bump when the profile prompt or schema changes — older profiles are then
// regenerated (from cached transcripts, so no Supadata cost).
export const PROFILE_VERSION = 6; // v6: + junk ladder, videos without captions rated from metadata + images, known-channel pace floor (v5: stimulation, stills, madeForKids; v4: gambling ladder)
// Oldest profile version still usable for filtering until reprofileOutdated upgrades it
export const MIN_USABLE_PROFILE_VERSION = 3;

const PROFILE_SYSTEM_PROMPT = `You describe the content of YouTube videos for a parental control app.
You do NOT decide whether a video is appropriate — you only report what is in it, accurately, on fixed 0–4 ladders.
You get the metadata, PACE STATS counted from the transcript, the transcript, and (usually) 4 small still images: the thumbnail and 3 frames from the start, middle and end.
For each category, first write the evidence (what in the transcript/metadata/images supports the rating, quoting briefly; cite images as "thumbnail" or "frame 1/2/3"), THEN the level.
Use the images for every category: if they show something the transcript doesn't mention (violence, scary imagery, revealing clothing, gambling, dangerous stunts), rate it and cite the image.
If there is no evidence for a category, its level is 0 and evidence is "".
Use level null ONLY if the category depends on visuals and neither the transcript nor the images give a way to tell. Never use null for stimulation.

Respond with valid JSON only, in this exact shape:
{
  "summary": "2-3 sentences: what the video is about",
  "topics": ["3-8 short tags, e.g. video games, bodybuilding, dating, space"],
  "purpose": "entertainment" | "educational" | "news" | "devotional" | "commercial",
  "violence":    { "evidence": "", "level": 0, "realism": "none" | "cartoon_fantasy" | "realistic_fiction" | "real_footage", "framing": "neutral" | "condemned" | "glorified" },
  "scary":       { "evidence": "", "level": 0 },
  "language":    { "evidence": "", "level": 0 },
  "romance":     { "evidence": "", "level": 0 },
  "sexual":      { "evidence": "", "level": 0 },
  "substances":  { "evidence": "", "level": 0, "framing": "neutral" | "condemned" | "glorified" },
  "dangerous":   { "evidence": "", "level": 0 },
  "selfHarm":    { "evidence": "", "level": 0, "framing": "neutral" | "condemned" | "glorified" },
  "meanness":    { "evidence": "", "level": 0, "framing": "neutral" | "condemned" | "glorified" },
  "consumerism": { "evidence": "", "level": 0 },
  "politics":    { "evidence": "", "level": 0 },
  "religion":    { "evidence": "", "level": 0, "traditions": [], "themes": [] },
  "gambling":    { "evidence": "", "level": 0 },
  "stimulation": { "evidence": "", "level": 0 },
  "junk":        { "evidence": "", "level": 0 },
  "crudeHumor":  { "evidence": "", "level": 0 },
  "matureThemes":{ "evidence": "", "level": 0 },
  "misinformation": { "evidence": "", "level": 0 },
  "nudity":      { "evidence": "", "level": 0 },
  "holidays":    [ { "name": "christmas", "prominence": "theme" | "incidental" } ],
  "music":       { "level": "none" | "background" | "prominent" | "music_video" },
  "lgbtq":       "none" | "incidental" | "discussion" | "advocacy",
  "flags": { "fantasyMagic": false, "realOccult": false, "prophetDepiction": false, "religiousExclamations": false,
             "pork": false, "nonKosher": false, "alcoholFood": false, "beef": false, "evolution": false, "matureGames": false }
}

Ladders (0 = none in every category):
- violence: 1 slapstick/cartoon, no injury (Tom & Jerry). 2 game, fantasy or sports combat, no blood (Minecraft, superhero fights). 3 realistic fights, injury or death described, weapons used (war history, action recap). 4 graphic or gory detail, real deaths, torture.
- scary: 1 mild suspense. 2 spooky, monsters (Goosebumps-style). 3 horror themes, jump scares, creepypasta. 4 intense horror.
- language: 1 insults like "stupid", "shut up". 2 mild swearing: damn, hell, crap. 3 moderate: ass, bitch, dick, shit. 4 strong: f-word, slurs. ("Hell's Kitchen" or "hell" as a place is not swearing.)
- romance: 1 crushes, hand-holding. 2 dating relationships, kissing. 3 ongoing romantic or physical focus. 4 sexualized romance.
- sexual: 1 mild innuendo most kids would miss. 2 crude sexual jokes or references. 3 sexual discussion or suggestive content. 4 explicit. (Ordinary friendship or family affection is 0.)
- substances (alcohol, smoking/vaping, cannabis, drugs): 1 mentioned. 2 shown or discussed. 3 use shown. 4 detailed or glamorized use.
- dangerous (stunts/challenges kids might copy): 1 clearly professional or safe stunts. 2 risky stunts with warnings. 3 risky stunts without consequences or warnings. 4 dangerous how-to (weapons, fire, chemicals) or harmful challenges.
- selfHarm (suicide, self-harm, eating disorders): 1 only supportive, help-seeking discussion. 2 neutral discussion. 3 detailed or glamorized. 4 instructions or encouragement.
- meanness (pranks, bullying, disrespect): 1 gentle, good-natured pranks or teasing. 2 mean pranks or insults played for laughs, disrespect to parents/teachers. 3 sustained bullying or humiliation. 4 cruelty or harassment encouraged.
- consumerism: 1 brief sponsor mention. 2 extended sponsor segment or product promotion. 3 unboxing, hauls, "buy my merch". 4 constant selling or pressure to buy.
- politics: 1 factual civics or history without taking sides. 2 news reporting. 3 opinion, advocacy, or satire of politicians and policies. 4 extreme or hateful political content.
- religion: 1 descriptive or educational. 2 devotional or worship content. 3 trying to convert viewers. 4 mocking or disrespecting religion. "traditions": which religions appear, ONLY from: "islam", "judaism", "christianity", "hinduism", "sikhism", "buddhism", "other". "themes": short phrases, e.g. "celebrates Christmas traditions", "explains Ramadan".
- crudeHumor: 1 mild silly gross-out (a burp). 2 toilet humor (fart/poop jokes). 3 frequent gross-out humor. 4 extreme or disgusting.
- matureThemes (death, divorce, illness, war, abuse, crime): 1 brief mention. 2 a theme handled gently (a pet dies, parents divorce). 3 heavy themes discussed in depth. 4 disturbing detail.
- misinformation: 1 minor unverified claims. 2 pseudoscience or conspiracy theories presented as fact. 3 health or safety misinformation that could cause harm. 4 extremist conspiracy content.
- nudity: rate from transcript/metadata cues only (e.g. "bikini try-on"). 1 swimwear in a normal context. 2 revealing clothing is a focus. 3 partial nudity. 4 nudity. Use 0 when nothing suggests it; null only if the video is clearly about appearance/bodies and you can't tell.
- holidays: every holiday that appears, names ONLY from: christmas, easter, halloween, valentines, diwali, hanukkah, eid, ramadan, passover, lunar_new_year. "theme" = the video is about it; "incidental" = mentioned in passing. Empty array if none.
- music: transcripts mark music as "[Music]" or ♪, and song lyrics appear as text. none = no sign of music. background = music markers under talking. prominent = songs with lyrics or music as a main element. music_video = the video is a song/music video.
- lgbtq: none. incidental = LGBTQ+ people present without being the topic. discussion = LGBTQ+ topics discussed. advocacy = the video argues a position on LGBTQ+ issues (either direction).
- flags (true only with evidence): fantasyMagic = fictional magic (wizards, spells in a story). realOccult = presented as real: tarot, astrology, spells, Ouija, séances. prophetDepiction = a prophet (e.g. Muhammad, Moses, Jesus as prophet) is depicted/voiced/animated. religiousExclamations = God's or Jesus's name used as an exclamation ("oh my God", "Jesus Christ!"). pork / beef = shown or cooked as food. nonKosher = shellfish, or meat cooked with dairy. alcoholFood = cooking with alcohol. evolution = evolution or origins of life/humans is a topic. matureGames = gameplay of mature-rated games (GTA, Call of Duty, horror games).
- gambling (betting, casinos, lotteries, loot boxes/gacha): 1 mentioned in passing or as an example (a study that uses a bet, "it's a gamble"). 2 discussed or explained (how odds work, the history of casinos). 3 gambling shown or played (betting, casino games, opening loot boxes or gacha). 4 promoted: gambling sponsors or encouraging viewers to bet or buy loot boxes.
- stimulation (pace and sensory intensity — how hyper the video is, NOT whether its content is good): 0 calm and slow: gentle narration, long quiet stretches (Mister Rogers, slow nature footage). 1 gentle: relaxed talking or soft songs (Ms Rachel, Bob Ross). 2 lively: normal upbeat kids' show or explainer (Bluey, SciShow Kids, Numberblocks). 3 high energy: fast talking or nonstop songs, frequent sound effects, saturated colors, excited shouting (CoComelon, MrBeast, most toy-unboxing and gaming-reaction videos). 4 overstimulating: frantic, chaotic sensory overload with little or no story — rapid noise and visual chaos, "brainrot" memes (Skibidi Toilet), surprise-egg / color-learning spam, loud compilations.
  Judge from all signals together: PACE STATS (normal narration is ~120–160 words/min; 200+ is very fast; many sound tags per minute and repetition above ~0.3 mean nonstop songs, chants or noise), the title (ALL CAPS, emoji strings, "!!!", "CRAZY", "1 HOUR"), and the images (neon or highly saturated colors, cluttered frames, exaggerated faces, big text, flashing effects). Use what you know about the channel's typical style. Evidence names the signals, e.g. "230 wpm, songs throughout, neon cluttered frames".
- junk (low-effort, spam and fake kids' content — NOT about whether you like the topic): 0 a real show, creator or explainer. 1 low effort but harmless: slideshows, simple reuploads, toy videos with little to them. 2 clickbait or knock-offs: keyword-stuffed titles ("Spiderman Elsa Hulk Baby Bottle Learn Colors"), famous characters mashed together by a channel that clearly doesn't own them, misleading thumbnails. 3 spam or nonsense: the same clip looped with "effects" (e.g. "preview 2 effects", "sponsored by klasky csupo"), random mashups with no story, mass-produced filler. 4 disturbing content disguised as kids' content ("Elsagate"): cartoon or toy characters in violent, scary, medical (injections), toilet, pregnancy or sexualized situations.
  Judge from the title, description, tags, channel and images as much as the transcript — junk often has little or no speech.
- framing: "glorified" = shown as cool, funny, rewarded or desirable; "condemned" = consequences shown or presented as wrong; otherwise "neutral".
- purpose: "educational" only if teaching is the clear main purpose (documentary, explainer, history).`;

function profileUserPrompt(video: YouTubeVideoDetails, transcript: string, pace: PaceStats | undefined): string {
  const t = transcript.slice(0, 12000);
  const title = titleSignals(video.title);
  const paceLines = pace
    ? `- Words per minute: ${pace.wordsPerMinute}
- Sound tags per minute ([Music], [Applause], ♪…): ${pace.soundTagsPerMinute}
- Repetition (repeated 4-word phrases, 0–1): ${pace.repetition ?? "too short to tell"}`
    : "- No captions: words per minute and repetition unknown";
  return `VIDEO METADATA:
- Title: ${video.title}
- Channel: ${video.channelTitle}
- Description: ${video.description.slice(0, 500)}
- Tags: ${video.tags.slice(0, 20).join(", ")}
- Duration: ${Math.floor(video.durationSeconds / 60)}m ${video.durationSeconds % 60}s
- YouTube "made for kids": ${video.madeForKids ? "yes" : "no"}

PACE STATS (counted in code):
${paceLines}
- Title: ${title}

${
  transcript
    ? `TRANSCRIPT:
${t}${transcript.length > 12000 ? "\n[transcript truncated for length]" : ""}`
    : `TRANSCRIPT: none — this video has no captions (often music-only, or spam/junk with no speech).
Rate every category from the metadata and the images. Use null only where you truly can't tell; never null for stimulation or junk.`
}`;
}

// ── Pace stats, counted in code ────────────────────────────────
// Rough signals for the stimulation ladder; the AI combines them with the images.
const SOUND_TAG = /\[\s*[a-z][^\]]{0,30}\]|♪+/gi; // [Music], [Applause], [Laughter], ♪ — not censored "[ __ ]"

export function paceStats(transcript: string, durationSeconds: number): PaceStats {
  const minutes = Math.max(durationSeconds, 10) / 60;
  const tags = transcript.match(SOUND_TAG)?.length ?? 0;
  const words = transcript
    .replace(SOUND_TAG, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  let repetition: number | null = null;
  if (words.length >= 40) {
    const grams = words.length - 3;
    const seen = new Set<string>();
    let repeats = 0;
    for (let i = 0; i < grams; i++) {
      const g = `${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`;
      if (seen.has(g)) repeats++;
      else seen.add(g);
    }
    repetition = Math.round((repeats / grams) * 100) / 100;
  }
  return {
    wordsPerMinute: Math.round(words.length / minutes),
    soundTagsPerMinute: Math.round((tags / minutes) * 10) / 10,
    repetition,
  };
}

function titleSignals(title: string): string {
  const letters = title.match(/\p{L}/gu) ?? [];
  const caps = letters.filter((c) => c !== c.toLowerCase()).length;
  const capsPct = letters.length ? Math.round((caps / letters.length) * 100) : 0;
  const emoji = title.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  const bangs = title.match(/!/g)?.length ?? 0;
  return `${capsPct}% capital letters, ${emoji} emoji, ${bangs} "!"`;
}

// Channels whose style is well known: the AI rates single videos too low (a CoComelon
// song came out "gentle"), so their typical level is a floor. Lowercase substrings of
// the channel name. Edit freely — it only raises ratings.
const KNOWN_STIMULATION: [string, number][] = [
  ["cocomelon", 3],
  ["little baby bum", 3],
  ["chuchu tv", 3],
  ["blippi", 3],
  ["mrbeast", 3],
  ["skibidi", 4],
];

function knownStimulation(channelTitle: string): { level: number; evidence: string } | null {
  const name = channelTitle.toLowerCase();
  const hit = KNOWN_STIMULATION.find(([n]) => name.includes(n));
  return hit ? { level: hit[1], evidence: `${channelTitle}'s typical style` } : null;
}

// Thumbnail + YouTube's 3 automatic frames (start / middle / end, 120×90). Low detail = cheap.
function stillImages(video: YouTubeVideoDetails): string[] {
  const frames = [1, 2, 3].map((n) => `https://i.ytimg.com/vi/${video.videoId}/${n}.jpg`);
  return video.thumbnail ? [video.thumbnail, ...frames] : frames;
}

// ── Swear-word floor, counted in code ──────────────────────────
// Unambiguous words only; context-dependent ones (hell, damn) are left to the AI.
const EXCLAMATION = /\b(oh my god|omg|oh god|god ?damn\w*|for god'?s sake|jesus christ)\b/i;
const MUSIC_MARK = /\[\s*music\s*\]|♪/i;
// YouTube captions often censor swearing as "[ __ ]" — counted as at least moderate.
const STRONG = /\b(f+u+c+k+\w*|motherf\w+)\b/gi;
const MODERATE = /\b(shit\w*|bitch\w*|asshole\w*|bastard\w*|dick(head)?s?)\b/gi;
const CENSORED = /\[\s*_+\s*\]/g;

export function swearFloor(transcript: string): { level: number; evidence: string } {
  const strong = transcript.match(STRONG)?.length ?? 0;
  const moderate = transcript.match(MODERATE)?.length ?? 0;
  const censored = transcript.match(CENSORED)?.length ?? 0;
  if (strong) return { level: 4, evidence: `f-word ×${strong} in transcript` };
  if (moderate || censored) {
    const parts = [moderate && `moderate swear words ×${moderate}`, censored && `censored swear words ×${censored}`].filter(Boolean);
    return { level: 3, evidence: `${parts.join(", ")} in transcript` };
  }
  return { level: 0, evidence: "" };
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter((s) => s.trim()).slice(0, 10) : [];
}

function levelOf(v: unknown): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(`Invalid level ${JSON.stringify(v)}`);
  return n;
}

function framingOf(v: unknown): Framing {
  return v === "glorified" || v === "condemned" ? v : "neutral";
}

// Returns null if the AI call fails or returns an invalid profile (nothing is cached then).
export async function generateContentProfile(
  video: YouTubeVideoDetails,
  transcript: string,
  openAiApiKey: string
): Promise<Omit<ContentProfile, "createdAt"> | null> {
  const client = new OpenAI({ apiKey: openAiApiKey });
  const pace = transcript ? paceStats(transcript, video.durationSeconds) : undefined;
  const text = profileUserPrompt(video, transcript, pace);
  const ask = (withImages: boolean) =>
    client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        { role: "system", content: PROFILE_SYSTEM_PROMPT },
        {
          role: "user",
          content: withImages
            ? [
                { type: "text" as const, text },
                ...stillImages(video).map((url) => ({ type: "image_url" as const, image_url: { url, detail: "low" as const } })),
              ]
            : text + "\n\n(No images available — rate visual categories from the text only.)",
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1700,
      temperature: 0,
    });
  try {
    let completion;
    try {
      completion = await ask(true);
    } catch (err) {
      // e.g. an image URL that won't load — the profile is still worth having without them
      logger.warn(`[AI] Profile with images failed for "${video.title}", retrying text-only:`, err);
      completion = await ask(false);
    }
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");
    const p = JSON.parse(raw);

    const dims = {} as Record<Dim, DimRating>;
    for (const dim of DIMS) {
      const d = p[dim] ?? {};
      const evidence = String(d.evidence ?? "").slice(0, 200);
      const level = levelOf(d.level);
      dims[dim] = { level, evidence };
    }
    // Code-counted swearing can only raise the AI's language level
    const floor = swearFloor(transcript);
    if (floor.level > (dims.language.level ?? 0)) dims.language = floor;
    const known = knownStimulation(video.channelTitle);
    if (known && known.level > (dims.stimulation.level ?? 0)) {
      const ai = dims.stimulation.evidence;
      dims.stimulation = { level: known.level, evidence: ai ? `${known.evidence}; ${ai}` : known.evidence };
    }

    const holidaysOut = (Array.isArray(p.holidays) ? p.holidays : [])
      .filter((h: { name?: string }) => (HOLIDAYS as readonly string[]).includes(String(h?.name)))
      .map((h: { name: string; prominence?: string }) => ({
        name: h.name as Holiday,
        prominence: h.prominence === "theme" ? ("theme" as const) : ("incidental" as const),
      }));
    const musicLevels = ["none", "background", "prominent", "music_video"] as const;
    let musicLevel: ContentProfile["music"]["level"] = musicLevels.includes(p.music?.level) ? p.music.level : "none";
    if (musicLevel === "none" && MUSIC_MARK.test(transcript)) musicLevel = "background"; // captions mark music
    const flagsOut = {} as ContentProfile["flags"];
    for (const f of VALUE_FLAGS) flagsOut[f] = Boolean(p.flags?.[f]);
    if (EXCLAMATION.test(transcript)) flagsOut.religiousExclamations = true;

    const purposes = ["entertainment", "educational", "news", "devotional", "commercial"] as const;
    const realisms = ["none", "cartoon_fantasy", "realistic_fiction", "real_footage"] as const;
    const profile: Omit<ContentProfile, "createdAt"> = {
      version: PROFILE_VERSION,
      status: "ok",
      title: video.title,
      channelName: video.channelTitle,
      purpose: purposes.includes(p.purpose) ? p.purpose : "entertainment",
      dims,
      violenceRealism: realisms.includes(p.violence?.realism) ? p.violence.realism : "none",
      framing: {
        violence: framingOf(p.violence?.framing),
        substances: framingOf(p.substances?.framing),
        selfHarm: framingOf(p.selfHarm?.framing),
        meanness: framingOf(p.meanness?.framing),
      },
      religionTraditions: strList(p.religion?.traditions).map((t) => t.toLowerCase()),
      holidays: holidaysOut,
      music: { level: musicLevel },
      lgbtq: ["incidental", "discussion", "advocacy"].includes(p.lgbtq) ? p.lgbtq : "none",
      flags: flagsOut,
      religiousThemes: strList(p.religion?.themes),
      topics: strList(p.topics),
      summary: typeof p.summary === "string" ? p.summary.slice(0, 600) : "",
      madeForKids: video.madeForKids,
      basis: transcript ? "transcript" : "metadata",
      ...(pace ? { pace } : {}),
    };
    logger.info(
      `[AI] Profile for "${video.title}": ${DIMS.map((d) => `${d}=${dims[d].level}`).join(" ")} purpose=${profile.purpose} basis=${profile.basis} pace=${JSON.stringify(pace ?? null)} mfk=${video.madeForKids} topics=${JSON.stringify(profile.topics)}`
    );
    return profile;
  } catch (err) {
    logger.error(`[AI] Profile generation failed for "${video.title}":`, err);
    return null;
  }
}

// ── Religion / custom rules ────────────────────────────────────

export function needsValuesCheck(filters: ValueFilters): boolean {
  return Boolean(
    (filters.religiousSensitivity && filters.religion?.trim()) || filters.customRules?.trim()
  );
}

// Cache key for a values check: only the inputs that affect it.
export function hashValuesRules(filters: ValueFilters): string {
  const canonical = JSON.stringify({
    religion: filters.religiousSensitivity ? (filters.religion ?? "").trim().toLowerCase() : "",
    customRules: (filters.customRules ?? "").trim().toLowerCase(),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export interface ValuesCheckResult {
  violates: boolean;
  reason: string;
}

// Returns null on AI failure (caller treats as blocked, uncached).
export async function checkValuesRules(
  profile: ContentProfile,
  filters: ValueFilters,
  openAiApiKey: string
): Promise<ValuesCheckResult | null> {
  const rules: string[] = [];
  const religion = filters.religion?.trim();
  if (filters.religiousSensitivity && religion) {
    rules.push(
      `Religion: ${religion} family. A conflict is ONLY content that mocks or disparages ${religion}, promotes the worship or practices of another religion, or directly contradicts core ${religion} teachings. Secular humor, science, and everyday topics are NOT conflicts.`
    );
  }
  if (filters.customRules?.trim()) {
    rules.push(
      `Parent's custom rules: ${filters.customRules.trim()} (Ignore any part about time of day, schedules or screen time — judge content only.)`
    );
  }

  const client = new OpenAI({ apiKey: openAiApiKey });
  try {
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        {
          role: "system",
          content: `You check a video description against a parent's rules for a parental control app.
Only report a violation if the description gives concrete evidence that a rule is broken. Do not speculate about what the video "may" contain.
Respond with valid JSON only: {"violates": true | false, "reason": "if violates: which rule and the specific content, one sentence for the parent; otherwise empty"}`,
        },
        {
          role: "user",
          content: `VIDEO: ${profile.title}
Summary: ${profile.summary}
Topics: ${profile.topics.join(", ") || "none"}
Religious themes: ${profile.religiousThemes.join("; ") || "none"}

RULES:
${rules.map((r) => `• ${r}`).join("\n")}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 150,
      temperature: 0.1,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from OpenAI");
    const p = JSON.parse(raw);
    const result = {
      violates: Boolean(p.violates),
      reason: p.violates && typeof p.reason === "string" ? p.reason.slice(0, 300) : "",
    };
    logger.info(`[AI] Values check for "${profile.title}": violates=${result.violates} ${result.reason}`);
    return result;
  } catch (err) {
    logger.error(`[AI] Values check failed for "${profile.title}":`, err);
    return null;
  }
}

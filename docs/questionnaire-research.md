# Parent questionnaire — design and sources

How Kideos decides what a child sees, and why it's built this way. Code: `functions/src/prefs.ts`
(questions, age defaults — copied to `apps/KideosParent/src/prefs.ts`),
`functions/src/aiAnalysis.ts` (content profile prompt), `functions/src/visualCheck.ts` (image floors),
`functions/src/contentFilter.ts` (matching), `functions/src/channelCheck.ts` (channel check before adding).

## Design

- **One content profile per video**, generated once by AI from the transcript, the metadata and 4 still
  images (thumbnail + 3 frames), rating each dimension on a shared 0–4 ladder (modelled on the Australian
  Classification "impact" hierarchy). Evidence is written before each level; `null` = can't tell.
  **Floors the AI can't go under:** profanity and God's-name exclamations counted in code; image
  moderation scores (sexual, violent, graphic, self-harm); a known-channel pace floor; parents' "Too hyper"
  reports. **Images only ever raise a rating** — added after a cartoon sex scene with innocent-sounding
  dialogue ("wanna do it again?") passed on the words alone. Videos without captions are rated from the
  metadata + images instead of being skipped.
- **One channel profile per channel**, made once when a parent first adds it: the 50 latest thumbnails +
  a reputation search, on the same ladders and definitions, applied to each child in the same code — a
  warning before adding, not a replacement for the per-video checks.
- **Per-child answers are applied in code** — changing them re-checks every video instantly, free.
- **Question format: "allow up to this level" ladders with concrete examples** at every rung, not
  yes/no or 1–5 importance scales. Construct-specific items are more reliable than agree/disagree or
  yes/no (Krosnick & Presser; Saris et al.: .88–.93 vs .68–.71 reliability; Lelkes & Weiss 2015 found
  no difference — advantage real but not universal). Importance scales don't give a cut-point.
- **Above the line: hidden.** No approval queue or notifications (parents wanted less work): the Videos
  screen shows what's hidden and why, and "Show anyway" (behind a confirmation) lets one video through.
- **Context modifiers:** educational videos +1 level (violence, scary, substances, politics);
  glamorized violence/substances/self-harm/cruelty hidden at any level (NTVS: risk highest when violence
  is attractive, justified, unpunished, consequence-free).
- **Quick start first, optional sections later** — answer quality drops later in long web surveys
  (Galesic & Bosnjak 2009).
- **Free text → structured settings once, at setup** (`parseCustomRules`), confirmed by the parent.
  Leftovers are checked per video by AI against the short summary.

## Dimensions and why

Core: violence, scary, language, romance, sexual, substances, dangerous stunts, self-harm, meanness/pranks,
consumerism, politics, religion, gambling, pace & stimulation, junk & knock-offs. Advanced: crude humor,
mature themes, misinformation, nudity (best effort), LGBTQ+ (neutral options — families differ), mature
games. Switches: made-for-kids only (YouTube's own label), no Shorts.

**Pace & stimulation** (added Oct 19 at the sister's request — "CoComelon and brainrot"): calm → gentle →
lively → high energy → overstimulating, with anchor examples (Ms Rachel 1, Bluey 2, CoComelon / MrBeast 3,
Skibidi Toilet 4). Lillard & Peterson (2011): 4-year-olds did worse on executive-function tasks right after
9 minutes of a fast-paced cartoon than after an educational one or drawing. We can't measure cut speed (it
needs the video itself), so the rating combines code-counted pace stats (words per minute, `[Music]`-style
tags per minute, repeated phrases), title style, the 4 stills and the channel's known style. Defaults
2/3/3/4/4 by age; a quiet video with frantic cuts can still slip — parents' "Too hyper" button covers that.

**Junk & knock-offs** (added Oct 19): low effort → clickbait / knock-off characters → looped "effects"
spam → disturbing content dressed as kids' content ("Elsagate"). Clickbait in general was left out (coders
couldn't agree on it — see Known limits), but its extreme forms are easy to recognise and are what parents
actually find: keyword-stuffed titles ("Spiderman Elsa Hulk Learn Colors"), famous characters mashed
together by channels that don't own them, the same clip looped with effects. Usually no speech, so it's
judged from the title, tags and images.

Gambling started as present/absent; real data showed passing mentions (a psychology study using a bet,
a joke about betting on golf) landing at the worst level. Since profile v4 it's a ladder like the others:
mentioned → discussed → shown → promoted (default for kids: passing mentions OK).

- BBFC 2024 consultation (12,000 people): suicide/self-harm now the #2 concern; misogynistic/sexual
  language and glamorized drugs matter more than mere presence.
- Common Sense / U. Michigan 2020 (1,639 kids' YouTube videos): ads in 95%, products in 45%, 27% aimed at
  older audiences, 20% interpersonal meanness/pranks, ~4–5% high educational value → consumerism and
  meanness are the bulk of the problem on YouTube.
- Pew 2020: 46% of parents of under-12 YouTube viewers say the child saw inappropriate videos.

## Age defaults

Synthesis of Common Sense age bands, ESRB E/E10+/T, YouTube 9+/13+, Australian G/PG/M —
**not a validated standard**; adjust after real usage.

## Faith and family values — no presets

We tried faith presets (e.g. "Muslim — vocals only", "Jewish — Haredi") and removed them: each bundled
strictness under a religious label (a "no music" preset also tightened romance, modesty and magic), which
is exactly the generalization we want to avoid — and practice varies widely within every tradition
(research below), so wrong pre-filled answers would be trusted and left unchecked.

Instead, every family sees the same concrete questions, all defaulting to OK: holidays (OK / in passing /
hide), pork, non-kosher food, cooking with alcohol, beef, prophet depictions, God's name as an
exclamation, fantasy magic, real-world occult, evolution, videos with music. An optional "which faith is
your family?" answer has one effect: that faith's own religious content doesn't count against the
"other faiths" limit.

**Music is best effort and deliberately simple** (OK / hide): transcripts only reveal music
through caption markers ("[Music]", ♪) and lyrics. Background music is often unmarked, and instruments
vs voices (nasheeds) or who is singing can't be detected at all, so those options were dropped.

Research on what families in each tradition raise (kept for reference): Muslim — music opinion divided
(IslamQA vs al-Qaradawi/Shaltut), prophet depictions widely prohibited, pork/alcohol; Jewish — kol isha,
other-faith holidays, kashrut, wide variation within Orthodoxy; Christian — Plugged In (spiritual content,
God's name, occult), USCCB (ridicule of faith); Hindu — beef, mocking portrayals; Sikh — general values.

## Suggested channels — a higher bar than filtering

Filtering a channel the parent chose is safe even if many of its videos are hidden — only the fitting
ones show. Suggesting a channel is different: it vouches for the channel (and a kid who likes it will find
the rest of it on YouTube). So a channel is suggested only if ≥75% of its checked videos fit the child,
at most 2 are *severe* (the top of a ladder the parent hasn't allowed, or self-harm ≥3 — absolute, not
relative to how strict the child's settings are), it has ≥10 checked videos, and it's **made for** the
child's age (±1 year). Example from testing: EpicMealTime had 17/50 fitting Shorts for a 6-year-old — not
suggested; SciShow isn't sunk by one predator video, but isn't suggested to a 6-year-old either (made for
12+).

## Channel check — a warning before adding

Parents asked to know *before* adding a channel whether it's "known for weird stuff", and thumbnails are
part of what the child sees in the feed. Checking every frame of every video was too expensive (~$1 per
channel), so instead each channel gets one check, shared by every family: its latest 50 thumbnails + a
Google search for what parents and press say, saved as a full channel profile on the same ladders. Each
child's fit is worked out in code from that saved profile, so a 6-year-old and a 16-year-old get different
answers from one check, and changing settings never costs another AI call. The review is a warning with
a confirm button — the per-video checks still decide what the child actually sees. Tone matters: a
channel whose only issue is sponsors shows a calm "1 thing to know", not the red "Not a fit".

## Known limits

- LLM accuracy evidence is from adjacent tasks (toxicity r≈0.61 vs humans; GPT-4 κ 0.54–0.62 on violent
  speech; script-based MPAA prediction 78% F1), not GPT-4o-mini on YouTube transcripts.
- Visuals are sampled, not watched: a video's thumbnail + 3 frames (start / middle / end) and a channel's
  50 thumbnails. A scene between frames can slip. Music and who is singing are still best effort.
- Image-moderation thresholds are a first guess, and the moderation model is mostly trained on photos —
  cartoons may score lower. Tune from real logs.
- The channel check's reputation search (Gemini Flash-Lite) can be shallow — e.g. IShowSpeed's swearing
  came back "mild" until floors from his analyzed videos were added. Small channels have little online,
  so they're judged from thumbnails only (and labelled that way).
- Clickbait was left out: even trained human coders couldn't agree on it (Common Sense/Michigan study).
- **Before launch:** label 300–500 videos with 2–3 raters; only use dimensions with weighted κ ≥ 0.7 as
  hard filters; fix the prompt for the rest (or make their defaults more conservative). Plan: [backlog.md](backlog.md) → *Check the AI against people*.

## Sources

- Lillard & Peterson 2011, fast-paced TV and executive function (Pediatrics): https://uva.theopenscholar.com/early-development-lab/publications/immediate-impact-different-types-television-young-childrens
- Elsagate overview: https://en.wikipedia.org/wiki/Elsagate
- Common Sense Media ratings: https://www.commonsensemedia.org/about-us/our-mission/about-our-ratings
- Common Sense young kids & YouTube (2020): https://www.commonsensemedia.org/sites/default/files/research/report/2020_youngkidsyoutube-report_final-release_forweb_1.pdf
- Australian Classification: https://www.classification.gov.au/classification-ratings/how-rating-decided
- BBFC 2024 guidelines: https://www.bbfc.co.uk/features/new-classification-guidelines-shaped-by-you
- Pew 2020: https://www.pewresearch.org/internet/2020/07/28/parenting-children-in-the-age-of-screens/
- NTVS: https://www.encyclopedia.com/media/encyclopedias-almanacs-transcripts-and-maps/national-television-violence-study
- Krosnick & Presser: https://web.stanford.edu/dept/communication/faculty/krosnick/docs/2010/2010%20Handbook%20of%20Survey%20Research.pdf
- Saris et al.: https://web.stanford.edu/dept/communication/faculty/krosnick/docs/Saris%20Paper%20-%20New%202005.pdf
- Lelkes & Weiss 2015: https://journals.sagepub.com/doi/10.1177/2053168015604173
- Plugged In: https://www.pluggedin.com/blog/making-wise-entertainment-choices-how-to-use-a-plugged-in-review/
- USCCB ratings: https://www.usccb.org/faq/general
- IslamQA on music: https://islamqa.info/en/answers/5000 · al-Qaradawi summary: https://www.islamicity.org/3018/singing-and-music-in-islam/
- Prophet depiction: https://aboutislam.net/counseling/ask-the-scholar/fiqh/can-watch-series-prophet-embodied/
- Kol isha: https://jewishlink.news/rebbetzin-tap-launches-kol-isha-for-women-and-girls-only/
- Orthodox media divide: https://jewinthecity.com/2011/07/what-do-orthodox-jewish-kids-and-teens-do-for-fun/
- For the Strength of Youth 2022: https://www.deseret.com/2022/10/1/23381979/10-new-things-to-know-about-the-new-for-the-strength-of-youth/
- Hinduism in media: https://www.hinduismtoday.com/magazine/oct-nov-dec-2021/hinduism-in-the-american-media/
- SikhNet kids: https://sikhnet.com/kids

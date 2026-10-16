# Parent questionnaire — design and sources

How Kideos decides what a child sees, and why it's built this way. Code: `functions/src/prefs.ts`
(questions, age defaults, faith presets — copied to `apps/KideosParent/src/prefs.ts`),
`functions/src/aiAnalysis.ts` (content profile prompt), `functions/src/contentFilter.ts` (matching).

## Design

- **One content profile per video**, generated once by AI from the transcript, rating each dimension
  on a shared 0–4 ladder (modelled on the Australian Classification "impact" hierarchy). Evidence is
  written before each level; `null` = can't tell from the transcript. Profanity and God's-name
  exclamations are also counted in code (a floor the AI can't go under).
- **Per-child answers are applied in code** — changing them re-checks every video instantly, free.
- **Question format: "allow up to this level" ladders with concrete examples** at every rung, not
  yes/no or 1–5 importance scales. Construct-specific items are more reliable than agree/disagree or
  yes/no (Krosnick & Presser; Saris et al.: .88–.93 vs .68–.71 reliability; Lelkes & Weiss 2015 found
  no difference — advantage real but not universal). Importance scales don't give a cut-point.
- **Above the line: Hide, or Ask me first** (held out of the feed until the parent approves).
- **Context modifiers:** educational videos +1 level (violence, scary, substances, politics);
  glamorized violence/substances/self-harm/cruelty hidden at any level (NTVS: risk highest when violence
  is attractive, justified, unpunished, consequence-free).
- **Quick start first, optional sections later** — answer quality drops later in long web surveys
  (Galesic & Bosnjak 2009).
- **Free text → structured settings once, at setup** (`parseCustomRules`), confirmed by the parent.
  Leftovers are checked per video by AI against the short summary.

## Dimensions and why

Core: violence, scary, language, romance, sexual, substances, dangerous stunts, self-harm, meanness/pranks,
consumerism, politics, religion, gambling. Advanced: crude humor, mature themes, misinformation, nudity
(best effort), LGBTQ+ (neutral options — families differ), mature games.

- BBFC 2024 consultation (12,000 people): suicide/self-harm now the #2 concern; misogynistic/sexual
  language and glamorized drugs matter more than mere presence.
- Common Sense / U. Michigan 2020 (1,639 kids' YouTube videos): ads in 95%, products in 45%, 27% aimed at
  older audiences, 20% interpersonal meanness/pranks, ~4–5% high educational value → consumerism and
  meanness are the bulk of the problem on YouTube.
- Pew 2020: 46% of parents of under-12 YouTube viewers say the child saw inappropriate videos.

## Age defaults

Synthesis of Common Sense age bands, ESRB E/E10+/T, YouTube 9+/13+, Australian G/PG/M —
**not a validated standard**; adjust after real usage.

## Faith presets

Presets only pre-fill concrete, editable answers; matching never uses the religion label.
Sub-presets reflect internal diversity.

- **Muslim** — music opinion genuinely divided (IslamQA: impermissible; al-Qaradawi / Shaltut: permitted
  if not obscene) → three music options. Prophet depictions widely prohibited (Islamic Fiqh Council,
  AMJA). Pork/alcohol in food. Magic views vary (IslamOnline vs IslamWeb).
- **Jewish** — Haredi: kol isha (women's singing), modesty, no other-faith holidays (OU on Halloween;
  "chukat goyim" on Christmas); many avoid open internet video entirely. Modern Orthodox / Traditional /
  Secular progressively lighter (Jew in the City: wide divide on media within Orthodoxy).
- **Christian** — Evangelical: Plugged In categories (spiritual content, misuse of God's name, occult).
  Catholic: USCCB "O" rating for ridicule of faith. LDS: For the Strength of Youth (2022, principle-based).
- **Hindu** — beef; stereotyped/mocking portrayals (Hindu American Foundation, Hinduism Today).
- **Sikh** — light preset (SikhNet: general values concern, no item list).
- **Buddhist** — no preset: no parent media-guidance sources found. Consult community members first.

## Known limits

- LLM accuracy evidence is from adjacent tasks (toxicity r≈0.61 vs humans; GPT-4 κ 0.54–0.62 on violent
  speech; script-based MPAA prediction 78% F1), not GPT-4o-mini on YouTube transcripts.
- Transcripts can't show visuals: nudity, gore, music, who is singing are best effort.
- Clickbait was left out: even trained human coders couldn't agree on it (Common Sense/Michigan study).
- **Before launch:** label 300–500 videos with 2–3 raters; only use dimensions with weighted κ ≥ 0.7 as
  hard filters, default the rest to "Ask me".

## Sources

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

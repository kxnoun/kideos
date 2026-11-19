# Labeling check (pilot)

Measures how well the AI's video ratings match a human's, using quadratic-weighted Cohen's kappa
per dimension. This is the pilot for backlog item 1: **40 videos, 6 dimensions** (violence, scary,
language, meanness, stimulation, junk), one rater. The full round (~100+ videos, all dimensions,
2–3 raters) comes later.

## Setup (once)

```
pip install firebase-admin
gcloud auth application-default login
```

The project defaults to `kideos-io`; set `KIDEOS_PROJECT` for a self-hosted server.

## Run

```
python label_eval.py sample 40   # picks videos; the AI's levels go in ai_ratings.json — don't open it
python label_eval.py rate        # opens each video, you rate 0–4 ('?' = can't tell); q saves and quits
python label_eval.py score       # writes results.md (scores) and disagreements.md (local only)
```

Skim each video rather than watching all of it: about 45 seconds a video, so roughly 30–40 minutes.
Use the note field when you're unsure or think the AI will get one wrong; notes show up next to the
biggest disagreements.

The sample is half videos where the AI rated some dimension 2 or higher and half random, one video per
channel across the whole sample. Kids' videos are mostly zeros, so a purely random sample can't tell a good rater from one that
always says 0.

Only profiles from the current prompt are sampled: `KIDEOS_PROFILE_VERSION`, default 7, which must match
`PROFILE_VERSION` in `functions/src/aiAnalysis.ts` (bump both together). The AI levels include the
code-applied floors (counted swearing, image moderation, known high-energy channels), so this measures what
Kideos actually stores.

Only `results.md` (the per-dimension scores) is committed. The rating files and `disagreements.md` stay
local (see `.gitignore`), because the repo never holds AI ratings of individual YouTube videos.

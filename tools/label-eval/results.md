# Kideos labeling pilot: 40 videos, 1 human rater

Quadratic-weighted Cohen's kappa, AI vs human, on the 0-4 scales. Target >= 0.7.

- The AI levels are what Kideos stores, so they include the code-applied floors (counted swearing, image moderation, known high-energy channels), not only the model's answer.
- Profiles from the current prompt only (profile version 7).
- Sample: half picked where the AI rated some dimension 2+, half random, spread across 11 channels (one per channel until channels run out). That over-represents non-zero videos on purpose, which tends to give a higher kappa than a typical mix of kids' videos would.
- Per-video disagreements are kept out of the repo: no AI ratings of individual videos are published.

| Dimension | n | Weighted kappa | Exact match | Within 1 | AI higher | AI lower |
|---|---|---|---|---|---|---|
| violence | 40 | 0.35 | 65% | 90% | 18% | 18% |
| scary | 40 | 0.30 | 82% | 98% | 8% | 10% |
| language | 40 | 0.64 | 62% | 82% | 5% | 32% |
| meanness | 40 | 0.01 | 55% | 85% | 0% | 45% |
| stimulation | 40 | 0.01 | 60% | 85% | 25% | 15% |
| junk | 40 | -0.01 | 80% | 95% | 8% | 12% |
| **all (pooled)** | 240 | 0.61 | | | | |

## What the pilot found

Written by hand after scoring (`score` rewrites the table above and keeps this section).

**Pooled kappa 0.61, below the 0.7 target; only language (0.64) comes close.** Most of the gap is the
pilot's design rather than the AI:

1. **The rater had nowhere to put sexual content or substances.** The pilot left out the `sexual` and
   `substances` dimensions because they're rare, but several videos had them. The human rating went into
   whichever dimension was asked (sexual content as "language 4", drinking and sex references as
   "meanness 4", a disturbing animation as "stimulation 4"). By the ladders' definitions those
   dimensions should stay low for that content, so these count as disagreements the AI didn't cause.
2. **The human rated suitability; the ladders measure specific things.** Notes like "would never
   recommend to kids" came with high scores on dimensions that don't measure that. For example,
   stimulation is pace and noise, and violence 3 is defined to include "injury or death described", so a
   video that discusses war is a 3 even if it's harmless in tone.
3. **Mostly-zero dimensions make kappa unstable.** Junk and stimulation agree exactly on 80% and 60% of
   videos, but with few non-zero cases a couple of large misses take kappa to about 0.

**Real AI misses**, worth fixing in the prompt:

- Short Minecraft-style animations with sexualized content were not flagged as junk. Junk 4 is defined to
  cover "characters in sexualized situations", so these should have been caught; they're short and have
  little or no transcript, so the rating leans on title and images.
- A music video with swearing in the lyrics got a low language level, likely because the lyrics weren't
  in the captions.

**For the full round:** all dimensions (including sexual and substances), fresh videos the rater hasn't
seen AI ratings for, a written rule to rate each ladder's definition rather than overall suitability, more
channels (this sample came from 11), and 2–3 raters.

// ─────────────────────────────────────────────────────────────
// Kideos — image safety check (OpenAI moderation, free)
//
// The profile AI reads the transcript AND sees the stills, but it leans on the
// words: "that was amazing, wanna do it again" over a sex scene came out clean.
// So the stills also go through OpenAI's moderation model, whose only job is
// spotting sexual / violent / graphic images. Its scores are a FLOOR on the
// profile's ratings (applyVisualFloors) — the profile AI can't talk them down.
// ─────────────────────────────────────────────────────────────

import OpenAI from "openai";
import { logger } from "firebase-functions/v2";
import type { DimRating } from "./types";
import type { Dim } from "./prefs";

export interface VisualScores {
  sexual: number;
  sexualMinors: number;
  violence: number;
  graphic: number;
  selfHarm: number;
  worstImage: Record<string, string>; // category → which image scored highest
  checked: number; // images actually checked
}

// One request per image (the moderation model takes one image at a time).
export async function moderateImages(
  client: OpenAI,
  images: { url: string; label: string }[]
): Promise<VisualScores | null> {
  const out: VisualScores = { sexual: 0, sexualMinors: 0, violence: 0, graphic: 0, selfHarm: 0, worstImage: {}, checked: 0 };
  const results = await Promise.allSettled(
    images.map((img) =>
      client.moderations.create({
        model: "omni-moderation-latest",
        input: [{ type: "image_url", image_url: { url: img.url } }],
      })
    )
  );
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      logger.warn(`[visualCheck] ${images[i].label} not checked: ${String(r.reason).slice(0, 150)}`);
      return;
    }
    const s = r.value.results[0]?.category_scores;
    if (!s) return;
    out.checked++;
    const take = (key: keyof Omit<VisualScores, "worstImage" | "checked">, v: number) => {
      if (v > out[key]) {
        out[key] = v;
        out.worstImage[key] = images[i].label;
      }
    };
    take("sexual", s.sexual);
    take("sexualMinors", s["sexual/minors"]);
    take("violence", s.violence);
    take("graphic", s["violence/graphic"]);
    take("selfHarm", Math.max(s["self-harm"], s["self-harm/intent"], s["self-harm/instructions"]));
  });
  return out.checked ? out : null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Raises ratings to what the images show. Never lowers anything.
export function applyVisualFloors(dims: Record<Dim, DimRating>, v: VisualScores): string[] {
  const applied: string[] = [];
  const raise = (dim: Dim, level: number, why: string) => {
    if ((dims[dim].level ?? 0) >= level) return;
    dims[dim] = { level, evidence: dims[dim].evidence ? `${why}; ${dims[dim].evidence}` : why };
    applied.push(`${dim}=${level}`);
  };
  const where = (k: string) => v.worstImage[k] ?? "an image";

  if (v.sexualMinors >= 0.1) {
    raise("sexual", 4, `image check: ${where("sexualMinors")} sexualizes minors (${pct(v.sexualMinors)})`);
    raise("junk", 4, "image check: sexualized kids' content");
  }
  const sexLevel = v.sexual >= 0.85 ? 4 : v.sexual >= 0.5 ? 3 : v.sexual >= 0.25 ? 2 : 0;
  if (sexLevel) {
    const why = `image check: ${where("sexual")} looks sexual (${pct(v.sexual)})`;
    raise("sexual", sexLevel, why);
    raise("nudity", Math.min(sexLevel, 3), why);
  }
  if (v.graphic >= 0.4) raise("violence", 4, `image check: ${where("graphic")} looks graphic/gory (${pct(v.graphic)})`);
  else if (v.violence >= 0.5) raise("violence", 3, `image check: ${where("violence")} looks violent (${pct(v.violence)})`);
  if (v.selfHarm >= 0.5) raise("selfHarm", 3, `image check: ${where("selfHarm")} shows self-harm (${pct(v.selfHarm)})`);
  return applied;
}

// ─────────────────────────────────────────────────────────────
// Kideos — parseCustomRules (callable)
//
// Turns the parent's free-text "anything else?" box into concrete questionnaire
// changes ONCE, at setup — e.g. "no Halloween stuff" → holidays.halloween = hide.
// The parent app shows the changes for confirmation before applying them.
// Whatever can't be mapped is returned as `remaining` and stays a free-text
// rule (checked per video by AI against the summary).
// ─────────────────────────────────────────────────────────────

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import OpenAI from "openai";
import { APP_CONFIG, OPENAI_API_KEY } from "./config";
import { DIMS, HOLIDAYS, VALUE_FLAGS, LEVEL_LABELS, HOLIDAY_LABELS, VALUE_FLAG_LABELS } from "./prefs";

export interface RuleChange {
  key: string; // e.g. "holidays.halloween", "rules.language.max", "flags.pork", "music"
  value: string | number;
  explanation: string;
}

// Every key the AI may set, with its allowed values
function allowedValues(key: string): Array<string | number> | null {
  const [a, b, c] = key.split(".");
  if (a === "rules" && (DIMS as readonly string[]).includes(b)) {
    if (c === "max") return [0, 1, 2, 3, 4];
    if (c === "action") return ["hide", "review"];
  }
  if (a === "holidays" && (HOLIDAYS as readonly string[]).includes(b) && !c) return ["ok", "incidental", "review", "hide"];
  if (a === "flags" && (VALUE_FLAGS as readonly string[]).includes(b) && !c) return ["ok", "review", "hide"];
  if (key === "music") return ["ok", "review", "hide"];
  if (key === "lgbtq") return ["allow", "incidental", "review", "hide"];
  return null;
}

function catalog(): string {
  const lines: string[] = [];
  for (const d of DIMS) {
    lines.push(`rules.${d}.max: 0-4 — ${LEVEL_LABELS[d].map((l, i) => (l ? `${i}=${l}` : "")).filter(Boolean).join(", ")}`);
  }
  lines.push(`rules.<dim>.action: "hide" | "review" (review = hidden until the parent approves)`);
  for (const h of HOLIDAYS) lines.push(`holidays.${h} (${HOLIDAY_LABELS[h]}): "ok" | "incidental" (ok in passing, hidden as the theme) | "review" | "hide"`);
  for (const f of VALUE_FLAGS) lines.push(`flags.${f} (${VALUE_FLAG_LABELS[f]}): "ok" | "review" | "hide"`);
  lines.push(`music (videos with music, detected from captions): "ok" | "review" | "hide"`);
  lines.push(`lgbtq: "allow" | "incidental" (allow presence, review discussion) | "review" | "hide" (hide discussion/advocacy)`);
  return lines.join("\n");
}

export const parseCustomRules = onCall(
  { region: APP_CONFIG.FUNCTIONS_REGION, secrets: [OPENAI_API_KEY], timeoutSeconds: 30, memory: "256MiB" },
  async (request): Promise<{ changes: RuleChange[]; remaining: string }> => {
    const { parentId, text } = request.data as { parentId: string; text: string };
    if (request.auth?.uid !== parentId) throw new HttpsError("permission-denied", "Not your account");
    const input = String(text ?? "").trim().slice(0, 1000);
    if (!input) return { changes: [], remaining: "" };

    const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
    const completion = await client.chat.completions.create({
      model: APP_CONFIG.AI_MODEL,
      messages: [
        {
          role: "system",
          content: `You turn a parent's free-text wishes for their child's YouTube filter into settings changes.
Only map what the parent clearly asked for — never invent extra restrictions. Use only these settings:
${catalog()}

Respond with JSON only: {"changes": [{"key": "...", "value": ..., "explanation": "short, e.g. 'No Halloween videos'"}], "remaining": "the parts of the text that don't fit any setting, verbatim or lightly trimmed; empty string if everything fit"}
Ignore anything about time of day, schedules or screen time (put it in remaining).`,
        },
        { role: "user", content: input },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
      temperature: 0,
    });

    let parsed: { changes?: RuleChange[]; remaining?: string };
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    } catch {
      throw new HttpsError("internal", "Could not understand the rules");
    }
    const changes = (Array.isArray(parsed.changes) ? parsed.changes : []).filter((c) => {
      const allowed = allowedValues(String(c?.key));
      return allowed !== null && allowed.includes(c.value);
    });
    logger.info(`[parseCustomRules] ${parentId}: ${changes.length} changes, remaining="${parsed.remaining ?? ""}"`);
    return { changes, remaining: typeof parsed.remaining === "string" ? parsed.remaining.slice(0, 1000) : "" };
  }
);

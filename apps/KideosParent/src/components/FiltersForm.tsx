// ─────────────────────────────────────────────────────────────
// Kideos for Parents — FiltersForm (the per-child questionnaire)
//
// Each question is a ladder: the parent picks the most they're OK with, and
// anything past it is hidden (parents can browse Shown / Hidden in the Videos screen).
// Used by onboarding (SetFiltersScreen) and Settings.
// ─────────────────────────────────────────────────────────────

import React, { useState } from "react";
import { View, Text, TouchableOpacity, Switch, TextInput, StyleSheet, ActivityIndicator, Alert } from "react-native";
import {
  defaultPrefs,
  HOLIDAYS,
  HOLIDAY_LABELS,
  VALUE_FLAGS,
  VALUE_FLAG_LABELS,
  type Dim,
  type ValueFilters,
  type Tradition,
} from "../prefs";
import { parseCustomRules, type RuleChange } from "../services/firebase";
import { useStore } from "../store/useStore";

interface Option {
  level: number;
  label: string;
  example: string;
}

interface Question {
  dim: Dim;
  title: string;
  hint?: string;
  options: Option[];
}

const QUESTIONS: Question[] = [
  {
    dim: "violence",
    title: "Fighting and violence",
    options: [
      { level: 0, label: "None", example: "No fighting at all" },
      { level: 1, label: "Cartoon slapstick", example: "Tom & Jerry-style bonks, no one gets hurt" },
      { level: 2, label: "Game & fantasy combat", example: "Minecraft battles, superhero fights, no blood" },
      { level: 3, label: "Realistic violence", example: "Real fights, injuries or deaths described, war history" },
      { level: 4, label: "Graphic violence", example: "Gory detail, real deaths" },
    ],
  },
  {
    dim: "scary",
    title: "Scary content",
    options: [
      { level: 0, label: "Nothing scary", example: "" },
      { level: 1, label: "Mild suspense", example: "A tense moment, a mystery" },
      { level: 2, label: "Spooky & monsters", example: "Goosebumps-style ghosts and monsters" },
      { level: 3, label: "Horror", example: "Jump scares, creepypasta, horror game playthroughs" },
      { level: 4, label: "Intense horror", example: "Disturbing, gory horror" },
    ],
  },
  {
    dim: "language",
    title: "Swearing and rude words",
    hint: "Example: a gamer says “what the hell” after losing → that's Mild.",
    options: [
      { level: 0, label: "Clean only", example: "" },
      { level: 1, label: "Insults", example: "“stupid”, “shut up”" },
      { level: 2, label: "Mild swearing", example: "“damn”, “hell”, “crap”" },
      { level: 3, label: "Moderate swearing", example: "“ass”, “b*tch”, “sh*t”" },
      { level: 4, label: "Strong swearing", example: "The f-word" },
    ],
  },
  {
    dim: "romance",
    title: "Romance and dating",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Crushes", example: "Having a crush, holding hands" },
      { level: 2, label: "Dating & kissing", example: "Couples, dating, a kiss" },
      { level: 3, label: "Romantic focus", example: "The video is mostly about a relationship" },
      { level: 4, label: "Sexualized romance", example: "Romance with a sexual focus" },
    ],
  },
  {
    dim: "sexual",
    title: "Sexual references",
    hint: "Explicit sexual content is always hidden.",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Mild innuendo", example: "Double-meaning jokes most kids won't get" },
      { level: 2, label: "Crude sexual jokes", example: "Obvious sexual jokes or references" },
      { level: 3, label: "Sexual discussion", example: "Talking openly about sex" },
    ],
  },
  {
    dim: "substances",
    title: "Alcohol, smoking, vaping and drugs",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Mentioned", example: "Someone mentions beer or a vape" },
      { level: 2, label: "Discussed or shown", example: "A video about what vaping does" },
      { level: 3, label: "Use shown", example: "Someone drinks or smokes on camera" },
      { level: 4, label: "Detailed or glamorized", example: "Drug use shown in detail or made to look cool" },
    ],
  },
  {
    dim: "dangerous",
    title: "Dangerous stunts and challenges",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Safe or pro stunts", example: "Trained pros, safety gear" },
      { level: 2, label: "Risky, with warnings", example: "“Don't try this at home”" },
      { level: 3, label: "Risky, kids could copy", example: "No warnings, no consequences shown" },
      { level: 4, label: "Dangerous how-to", example: "Fire, weapons, chemicals, viral challenges" },
    ],
  },
  {
    dim: "selfHarm",
    title: "Suicide, self-harm and eating disorders",
    hint: "Detailed or glamorized content is always hidden.",
    options: [
      { level: 0, label: "Not at all", example: "" },
      { level: 1, label: "Supportive only", example: "Mental-health awareness, how to get help" },
      { level: 2, label: "Neutral discussion", example: "Talked about factually" },
    ],
  },
  {
    dim: "meanness",
    title: "Pranks, bullying and disrespect",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Gentle pranks", example: "Harmless, everyone laughs" },
      { level: 2, label: "Mean pranks & insults", example: "Humiliating pranks, rudeness to parents, played for laughs" },
      { level: 3, label: "Bullying", example: "Someone humiliated over and over" },
      { level: 4, label: "Cruelty", example: "Harassment encouraged" },
    ],
  },
  {
    dim: "consumerism",
    title: "Selling to your child",
    hint: "Sponsorships, unboxing, “buy my merch”.",
    options: [
      { level: 0, label: "No selling", example: "" },
      { level: 1, label: "Brief sponsor mentions", example: "“This video is sponsored by…”" },
      { level: 2, label: "Sponsor segments", example: "A minute-long ad read or product promo" },
      { level: 3, label: "Unboxing & merch", example: "Toy unboxing, hauls, “buy my merch”" },
      { level: 4, label: "Anything", example: "" },
    ],
  },
  {
    dim: "politics",
    title: "Politics and news",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Educational", example: "How elections work, history" },
      { level: 2, label: "News", example: "Reporting on current events" },
      { level: 3, label: "Opinions", example: "Takes sides, political satire" },
    ],
  },
  {
    dim: "religion",
    title: "Religion in videos",
    hint: "Videos that mock religion always count as past your limit.",
    options: [
      { level: 0, label: "No religious content", example: "" },
      { level: 1, label: "Educational only", example: "Explaining what a holiday or belief is" },
      { level: 3, label: "All religious content", example: "Worship, sermons, faith videos" },
    ],
  },
  {
    dim: "gambling",
    title: "Gambling",
    hint: "Betting, casinos, lotteries, loot boxes.",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Mentioned in passing", example: "A science video about a study that used a bet" },
      { level: 2, label: "Discussed", example: "How odds work, the history of casinos" },
      { level: 3, label: "Shown", example: "Casino games, betting, opening loot boxes" },
      { level: 4, label: "Promoted", example: "Gambling sponsors, \"go bet on…\"" },
    ],
  },
];

const ADVANCED_QUESTIONS: Question[] = [
  {
    dim: "crudeHumor",
    title: "Crude and toilet humor",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Silly gross-out", example: "A burp joke" },
      { level: 2, label: "Toilet humor", example: "Fart and poop jokes" },
      { level: 3, label: "Frequent gross-out", example: "Gross-out humor is the whole point" },
      { level: 4, label: "Extreme", example: "Disgusting on purpose" },
    ],
  },
  {
    dim: "matureThemes",
    title: "Mature life themes",
    hint: "Death, divorce, illness, war, abuse, crime.",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Brief mention", example: "Someone mentions a grandparent died" },
      { level: 2, label: "Handled gently", example: "A video about a pet dying, or parents divorcing" },
      { level: 3, label: "Heavy themes in depth", example: "War, abuse or crime discussed in detail" },
      { level: 4, label: "Disturbing", example: "Graphic or upsetting detail" },
    ],
  },
  {
    dim: "misinformation",
    title: "Misinformation and conspiracies",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Unverified claims", example: "“Fun facts” that aren't quite true" },
      { level: 2, label: "Pseudoscience as fact", example: "Flat earth, conspiracy theories presented as true" },
      { level: 3, label: "Harmful misinformation", example: "Dangerous health or safety claims" },
    ],
  },
  {
    dim: "nudity",
    title: "Nudity and revealing clothing",
    hint: "Best effort — we mostly can't see the video, only read what's said.",
    options: [
      { level: 0, label: "None", example: "" },
      { level: 1, label: "Swimwear, normal context", example: "A beach or swimming video" },
      { level: 2, label: "Revealing clothing as a focus", example: "A “bikini try-on” video" },
      { level: 3, label: "Partial nudity", example: "" },
    ],
  },
];

const TRADITIONS: { value: Tradition; label: string }[] = [
  { value: "", label: "None / prefer not to say" },
  { value: "islam", label: "Muslim" },
  { value: "judaism", label: "Jewish" },
  { value: "christianity", label: "Christian" },
  { value: "hinduism", label: "Hindu" },
  { value: "sikhism", label: "Sikh" },
  { value: "other", label: "Other" },
];

const FAITH_FLAGS = VALUE_FLAGS.filter((f) => f !== "matureGames");

// Applies one change from parseCustomRules ("holidays.halloween" = "hide", etc.)
function applyChange(p: ValueFilters, c: RuleChange): ValueFilters {
  const next: ValueFilters = JSON.parse(JSON.stringify(p));
  const [a, b, k] = c.key.split(".");
  if (a === "rules") (next.rules as any)[b][k] = c.value;
  else if (a === "holidays") (next.holidays as any)[b] = c.value;
  else if (a === "flags") (next.flags as any)[b] = c.value;
  else if (c.key === "music") next.music = c.value as ValueFilters["music"];
  else if (c.key === "lgbtq") next.lgbtq = c.value as ValueFilters["lgbtq"];
  return next;
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.value}
          style={[styles.segmentBtn, value === o.value && styles.segmentBtnActive]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[styles.segmentText, value === o.value && styles.segmentTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function LadderQuestion({
  q,
  value,
  onChange,
  title,
}: {
  q: Question;
  value: ValueFilters;
  onChange: (v: ValueFilters) => void;
  title?: string;
}) {
  const rule = value.rules[q.dim];
  const setRule = (patch: Partial<{ max: number }>) =>
    onChange({ ...value, rules: { ...value.rules, [q.dim]: { ...rule, ...patch } } });
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title ?? q.title}</Text>
      {q.hint ? <Text style={styles.sub}>{q.hint}</Text> : null}
      <Text style={styles.label}>The most you're OK with:</Text>
      {q.options.map((o) => {
        const selected = rule.max === o.level;
        return (
          <TouchableOpacity
            key={o.level}
            style={[styles.option, selected && styles.optionSelected]}
            onPress={() => setRule({ max: o.level })}
          >
            <View style={[styles.radio, selected && styles.radioSelected]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{o.label}</Text>
              {o.example ? <Text style={styles.optionExample}>{o.example}</Text> : null}
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.optionExample}>Anything past this is hidden.</Text>
    </View>
  );
}

function SectionHeader({ title, sub, open, onToggle }: { title: string; sub: string; open: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSub}>{sub}</Text>
      </View>
      <Text style={styles.chevron}>{open ? "▲" : "▼"}</Text>
    </TouchableOpacity>
  );
}

const FLAG_OPTIONS = [
  { value: "ok" as const, label: "OK" },
  { value: "hide" as const, label: "Hide" },
];

export default function FiltersForm({
  value,
  onChange,
}: {
  value: ValueFilters;
  onChange: (v: ValueFilters) => void;
}) {
  const user = useStore((s) => s.user);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showFaith, setShowFaith] = useState(Boolean(value.faith.tradition));
  const [parsing, setParsing] = useState(false);
  const [proposal, setProposal] = useState<{ changes: RuleChange[]; remaining: string } | null>(null);

  const resetToAge = () => {
    const d = defaultPrefs(value.ageGroup, value.sensitivity);
    onChange({ ...d, religiousSensitivity: value.religiousSensitivity, religion: value.religion, customRules: value.customRules });
  };

  const setFlag = (f: (typeof VALUE_FLAGS)[number], rule: "ok" | "hide") =>
    onChange({ ...value, flags: { ...value.flags, [f]: rule } });

  const turnIntoSettings = async () => {
    if (!user || !value.customRules.trim()) return;
    setParsing(true);
    try {
      setProposal(await parseCustomRules(user.uid, value.customRules));
    } catch {
      Alert.alert("Couldn't read those rules right now. Your text is saved and still checked by AI.");
    } finally {
      setParsing(false);
    }
  };

  const applyProposal = () => {
    if (!proposal) return;
    let next = value;
    for (const c of proposal.changes) next = applyChange(next, c);
    onChange({ ...next, customRules: proposal.remaining });
    setProposal(null);
  };


  return (
    <View>
      {/* About this child */}
      <View style={styles.card}>
        <Text style={styles.title}>About your child</Text>
        <Text style={styles.sub}>
          Age {value.ageGroup}. Answers below start from what's typical for this age — change anything.
        </Text>
        <Text style={styles.label}>Compared to most kids their age, scary or upsetting content affects them…</Text>
        <Segment
          options={[
            { value: "less", label: "Less" },
            { value: "average", label: "About average" },
            { value: "more", label: "More" },
          ]}
          value={value.sensitivity}
          onChange={(sensitivity) => onChange({ ...value, sensitivity })}
        />
        <TouchableOpacity onPress={resetToAge} style={styles.resetBtn}>
          <Text style={styles.resetText}>Reset all answers to recommended for age {value.ageGroup}</Text>
        </TouchableOpacity>
      </View>

      {QUESTIONS.map((q) => (
        <LadderQuestion
          key={q.dim}
          q={q}
          value={value}
          onChange={onChange}
          title={q.dim === "religion" && value.faith.tradition ? "Other faiths' religious content" : undefined}
        />
      ))}

      {/* Global rules */}
      <View style={styles.card}>
        <Text style={styles.title}>A few more rules</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>
            Allow one level more when a video is clearly educational (e.g. a WWII documentary)
          </Text>
          <Switch
            value={value.educationalBoost}
            onValueChange={(educationalBoost) => onChange({ ...value, educationalBoost })}
            trackColor={{ true: "#6C63FF" }}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>
            Always hide videos that make violence, drugs, self-harm or cruelty look cool or funny
          </Text>
          <Switch
            value={value.blockGlorified}
            onValueChange={(blockGlorified) => onChange({ ...value, blockGlorified })}
            trackColor={{ true: "#6C63FF" }}
          />
        </View>
        <Text style={styles.label}>When we can't check a video (e.g. it has no transcript):</Text>
        <Segment
          options={[
            { value: "allow", label: "Allow it" },
            { value: "hide", label: "Hide it" },
          ]}
          value={value.unknown}
          onChange={(unknown) => onChange({ ...value, unknown })}
        />
      </View>

      {/* Faith & family values */}
      <SectionHeader
        title="Faith and family values"
        sub="Optional — holidays, food, music, magic and more"
        open={showFaith}
        onToggle={() => setShowFaith(!showFaith)}
      />
      {showFaith && (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>Which faith is your family, if any?</Text>
            <Text style={styles.sub}>
              Only used so your own faith's religious videos don't count as “other faiths” above. It doesn't change
              any other answer.
            </Text>
            <View style={styles.chips}>
              {TRADITIONS.map((t) => (
                <TouchableOpacity
                  key={t.value || "none"}
                  style={[styles.chip, value.faith.tradition === t.value && styles.chipActive]}
                  onPress={() => onChange({ ...value, faith: { tradition: t.value } })}
                >
                  <Text style={[styles.chipText, value.faith.tradition === t.value && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Holidays</Text>
            <Text style={styles.sub}>“In passing” = fine if mentioned, hidden if it's what the video is about.</Text>
            {HOLIDAYS.map((h) => (
              <View key={h} style={styles.row}>
                <Text style={styles.rowLabel}>{HOLIDAY_LABELS[h]}</Text>
                <Segment
                  options={[
                    { value: "ok", label: "OK" },
                    { value: "incidental", label: "In passing" },
                    { value: "hide", label: "Hide" },
                  ]}
                  value={value.holidays[h]}
                  onChange={(rule) => onChange({ ...value, holidays: { ...value.holidays, [h]: rule } })}
                />
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Specific content</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Videos with music</Text>
              <Text style={styles.rowHint}>
                Best effort: we can only tell from the captions (YouTube marks some music as “[Music]”) and song
                lyrics. We can't tell instruments from voices, so nasheeds count as music too.
              </Text>
              <Segment
                options={FLAG_OPTIONS}
                value={value.music}
                onChange={(music) => onChange({ ...value, music })}
              />
            </View>
            {FAITH_FLAGS.map((f) => (
              <View key={f} style={styles.row}>
                <Text style={styles.rowLabel}>{VALUE_FLAG_LABELS[f]}</Text>
                <Segment options={FLAG_OPTIONS} value={value.flags[f]} onChange={(rule) => setFlag(f, rule)} />
              </View>
            ))}
          </View>
        </>
      )}

      {/* More topics */}
      <SectionHeader
        title="More topics"
        sub="Optional — crude humor, mature themes, misinformation, and more"
        open={showAdvanced}
        onToggle={() => setShowAdvanced(!showAdvanced)}
      />
      {showAdvanced && (
        <>
          {ADVANCED_QUESTIONS.map((q) => (
            <LadderQuestion key={q.dim} q={q} value={value} onChange={onChange} />
          ))}
          <View style={styles.card}>
            <Text style={styles.title}>LGBTQ+ people and topics</Text>
            {(
              [
                { value: "allow", label: "Allow all" },
                { value: "hide_discussion", label: "Allow people being present; hide discussion and advocacy" },
                { value: "hide_all", label: "Hide all of it" },
              ] as const
            ).map((o) => (
              <TouchableOpacity
                key={o.value}
                style={[styles.option, value.lgbtq === o.value && styles.optionSelected]}
                onPress={() => onChange({ ...value, lgbtq: o.value })}
              >
                <View style={[styles.radio, value.lgbtq === o.value && styles.radioSelected]} />
                <Text style={[styles.optionLabel, { flex: 1 }]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{VALUE_FLAG_LABELS.matureGames}</Text>
              <Segment
                options={FLAG_OPTIONS}
                value={value.flags.matureGames}
                onChange={(rule) => setFlag("matureGames", rule)}
              />
            </View>
          </View>
        </>
      )}

      {/* Anything else */}
      <View style={styles.card}>
        <Text style={styles.title}>Anything else?</Text>
        <Text style={styles.sub}>Write it in your own words — we'll turn what we can into the settings above.</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={value.customRules}
          onChangeText={(customRules) => onChange({ ...value, customRules })}
          placeholder="e.g. No Halloween stuff, no fast food ads, no YouTubers yelling..."
          placeholderTextColor="#aaa"
          multiline
          numberOfLines={3}
        />
        {value.customRules.trim() ? (
          <TouchableOpacity style={styles.parseBtn} onPress={turnIntoSettings} disabled={parsing}>
            {parsing ? <ActivityIndicator color="#6C63FF" /> : <Text style={styles.parseText}>Turn this into settings</Text>}
          </TouchableOpacity>
        ) : null}
        {proposal && (
          <View style={styles.proposal}>
            {proposal.changes.length ? (
              <>
                <Text style={styles.label}>We'll set:</Text>
                {proposal.changes.map((c, i) => (
                  <Text key={i} style={styles.proposalItem}>• {c.explanation}</Text>
                ))}
              </>
            ) : (
              <Text style={styles.proposalItem}>Nothing here matches a setting.</Text>
            )}
            {proposal.remaining ? (
              <Text style={styles.proposalItem}>
                We'll keep checking this with AI: “{proposal.remaining}”
              </Text>
            ) : null}
            <View style={styles.reviewRow}>
              <TouchableOpacity style={[styles.reviewBtn, styles.reviewApprove]} onPress={applyProposal}>
                <Text style={styles.reviewApproveText}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.reviewBtn, styles.reviewCancel]} onPress={() => setProposal(null)}>
                <Text style={styles.reviewCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={[styles.switchRow, { marginTop: 14 }]}>
          <Text style={styles.switchLabel}>Also check videos against our faith's values in general (AI)</Text>
          <Switch
            value={value.religiousSensitivity}
            onValueChange={(religiousSensitivity) => onChange({ ...value, religiousSensitivity })}
            trackColor={{ true: "#6C63FF" }}
          />
        </View>
        {value.religiousSensitivity && (
          <TextInput
            style={styles.input}
            value={value.religion}
            onChangeText={(religion) => onChange({ ...value, religion })}
            placeholder="e.g. Christian, Jewish, Muslim..."
            placeholderTextColor="#aaa"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },
  title: { fontSize: 17, fontWeight: "800", color: "#1A1A2E", marginBottom: 4 },
  sub: { fontSize: 13, color: "#777", marginBottom: 10, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: "700", color: "#555", marginBottom: 8, marginTop: 4 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: "#F7F7FF",
  },
  optionSelected: { backgroundColor: "#EEEDFF", borderWidth: 1, borderColor: "#6C63FF" },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#BBB", marginRight: 12 },
  radioSelected: { borderColor: "#6C63FF", backgroundColor: "#6C63FF" },
  optionLabel: { fontSize: 15, fontWeight: "600", color: "#333" },
  optionLabelSelected: { color: "#1A1A2E" },
  optionExample: { fontSize: 12, color: "#888", marginTop: 2 },
  segment: { flexDirection: "row", backgroundColor: "#E8E8F0", borderRadius: 10, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 8 },
  segmentBtnActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  segmentText: { fontSize: 12, fontWeight: "600", color: "#888" },
  segmentTextActive: { color: "#1A1A2E" },
  resetBtn: { marginTop: 12 },
  resetText: { fontSize: 13, color: "#6C63FF", fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  switchLabel: { fontSize: 14, color: "#444", flex: 1, paddingRight: 16, lineHeight: 20 },
  input: { backgroundColor: "#F7F7FF", borderRadius: 12, padding: 14, fontSize: 15, color: "#1A1A2E" },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EEEDFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: "#1A1A2E" },
  sectionSub: { fontSize: 13, color: "#666", marginTop: 2 },
  chevron: { fontSize: 14, color: "#6C63FF", marginLeft: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#F0F0F5", marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: "#6C63FF" },
  chipText: { fontSize: 14, fontWeight: "600", color: "#555" },
  chipTextActive: { color: "#fff" },
  row: { marginBottom: 14 },
  rowLabel: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 6 },
  rowHint: { fontSize: 12, color: "#888", marginBottom: 8, lineHeight: 17 },
  parseBtn: { marginTop: 10, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#6C63FF" },
  parseText: { color: "#6C63FF", fontWeight: "700", fontSize: 14 },
  proposal: { marginTop: 12, backgroundColor: "#F7F7FF", borderRadius: 12, padding: 12 },
  proposalItem: { fontSize: 14, color: "#333", marginBottom: 6, lineHeight: 20 },
  reviewRow: { flexDirection: "row", marginTop: 8 },
  reviewBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  reviewApprove: { backgroundColor: "#6C63FF", marginRight: 8 },
  reviewApproveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  reviewCancel: { backgroundColor: "#E8E8F0" },
  reviewCancelText: { color: "#555", fontWeight: "700", fontSize: 14 },
});

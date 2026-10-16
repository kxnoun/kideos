// ─────────────────────────────────────────────────────────────
// Kideos for Parents — FiltersForm (the per-child questionnaire)
//
// Each question is a ladder: the parent picks the most they're OK with, and
// what happens to videos that go past it — hidden, or held for their review.
// Used by onboarding (SetFiltersScreen) and Settings.
// ─────────────────────────────────────────────────────────────

import React from "react";
import { View, Text, TouchableOpacity, Switch, TextInput, StyleSheet } from "react-native";
import { defaultPrefs, type Dim, type OverAction, type ValueFilters } from "../prefs";

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
    hint: "Casino streams, betting, loot boxes, gambling sponsors.",
    options: [
      { level: 0, label: "Not allowed", example: "" },
      { level: 4, label: "Allowed", example: "" },
    ],
  },
];

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

export default function FiltersForm({
  value,
  onChange,
}: {
  value: ValueFilters;
  onChange: (v: ValueFilters) => void;
}) {
  const setRule = (dim: Dim, patch: Partial<{ max: number; action: OverAction }>) =>
    onChange({ ...value, rules: { ...value.rules, [dim]: { ...value.rules[dim], ...patch } } });

  const resetToAge = () => {
    const d = defaultPrefs(value.ageGroup, value.sensitivity);
    onChange({ ...d, religiousSensitivity: value.religiousSensitivity, religion: value.religion, customRules: value.customRules });
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

      {QUESTIONS.map((q) => {
        const rule = value.rules[q.dim];
        return (
          <View key={q.dim} style={styles.card}>
            <Text style={styles.title}>{q.title}</Text>
            {q.hint ? <Text style={styles.sub}>{q.hint}</Text> : null}
            <Text style={styles.label}>The most you're OK with:</Text>
            {q.options.map((o) => {
              const selected = rule.max === o.level;
              return (
                <TouchableOpacity
                  key={o.level}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setRule(q.dim, { max: o.level })}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{o.label}</Text>
                    {o.example ? <Text style={styles.optionExample}>{o.example}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            <Text style={[styles.label, { marginTop: 12 }]}>Videos that go past this:</Text>
            <Segment
              options={[
                { value: "hide", label: "Hide them" },
                { value: "review", label: "Ask me first" },
              ]}
              value={rule.action}
              onChange={(action) => setRule(q.dim, { action })}
            />
          </View>
        );
      })}

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
            { value: "review", label: "Ask me" },
            { value: "hide", label: "Hide it" },
          ]}
          value={value.unknown}
          onChange={(unknown) => onChange({ ...value, unknown })}
        />
      </View>

      {/* Faith + free text (kept until faith presets ship) */}
      <View style={styles.card}>
        <Text style={styles.title}>Faith and family values</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Check videos against our faith's values</Text>
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
        <Text style={[styles.label, { marginTop: 12 }]}>Anything else? (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={value.customRules}
          onChangeText={(customRules) => onChange({ ...value, customRules })}
          placeholder="e.g. No Halloween content, no fast food ads..."
          placeholderTextColor="#aaa"
          multiline
          numberOfLines={3}
        />
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
  segmentText: { fontSize: 13, fontWeight: "600", color: "#888" },
  segmentTextActive: { color: "#1A1A2E" },
  resetBtn: { marginTop: 12 },
  resetText: { fontSize: 13, color: "#6C63FF", fontWeight: "600" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  switchLabel: { fontSize: 14, color: "#444", flex: 1, paddingRight: 16, lineHeight: 20 },
  input: { backgroundColor: "#F7F7FF", borderRadius: 12, padding: 14, fontSize: 15, color: "#1A1A2E" },
  textArea: { minHeight: 80, textAlignVertical: "top" },
});

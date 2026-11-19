"""Kideos labeling check: compare the AI's 0-4 ratings with a human's, per dimension.

Pilot: 40 videos, 6 dimensions. See README.md in this folder.

  python label_eval.py sample 40   # pick videos, hide the AI's ratings in ai_ratings.json
  python label_eval.py rate        # rate them yourself (saves after every video, q to quit)
  python label_eval.py score       # agreement per dimension -> results.md
"""
import csv, json, os, random, sys, webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(HERE, "sample.json")        # video ids + titles (safe to look at)
AI = os.path.join(HERE, "ai_ratings.json")        # the AI's levels: don't open until you're done
HUMAN = os.path.join(HERE, "human_ratings.csv")   # your levels
RESULTS = os.path.join(HERE, "results.md")          # per-dimension scores only: safe to commit
DISAGREE = os.path.join(HERE, "disagreements.md")  # per-video AI levels: local only (never in the repo)

PROJECT = os.environ.get("KIDEOS_PROJECT", "kideos-io")
# Only profiles from the current prompt (PROFILE_VERSION in functions/src/aiAnalysis.ts). Older ones are
# re-made nightly by reprofileOutdated, so rating them would measure a prompt we no longer use.
PROFILE_VERSION = int(os.environ.get("KIDEOS_PROFILE_VERSION", "7"))

# Dimensions that actually vary across kids' videos. Rare ones (sexual, selfHarm, ...) are
# almost always 0, so 40 videos can't measure them; leave those for the full round.
DIMS = ["violence", "scary", "language", "meanness", "stimulation", "junk"]

# Short versions of the ladders in functions/src/aiAnalysis.ts. Rate on the same scale the AI uses.
LADDERS = {
    "violence": "0 none | 1 slapstick, no injury | 2 game/fantasy/sports combat, no blood | 3 realistic fights, injury/death, weapons | 4 graphic, gore, real deaths",
    "scary": "0 none | 1 mild suspense | 2 spooky, monsters | 3 horror themes, jump scares | 4 intense horror",
    "language": "0 none | 1 'stupid', 'shut up' | 2 damn, hell, crap | 3 ass, bitch, dick, shit | 4 f-word, slurs (hell as a place isn't swearing)",
    "meanness": "0 none | 1 gentle pranks/teasing | 2 mean pranks or insults for laughs | 3 sustained bullying | 4 cruelty encouraged",
    "stimulation": "0 calm (Mister Rogers) | 1 gentle (Ms Rachel) | 2 lively (Bluey, SciShow Kids) | 3 high energy (CoComelon, MrBeast) | 4 overstimulating (Skibidi, surprise-egg spam)",
    "junk": "0 real show/creator | 1 low effort, harmless | 2 clickbait, knock-off mashups | 3 spam/nonsense loops | 4 disturbing content disguised as kids' (Elsagate)",
}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)


def sample(n):
    import firebase_admin
    from firebase_admin import firestore

    firebase_admin.initialize_app(options={"projectId": PROJECT})
    db = firestore.client()
    docs = [d for d in db.collection("videoProfiles").stream()]
    rated = [(d.id, d.to_dict() or {}) for d in docs]
    rated = [(v, p) for v, p in rated if p.get("status") == "ok"]
    ok = [(v, p) for v, p in rated if p.get("version") == PROFILE_VERSION]
    print(f"{len(rated)} rated videos in Firestore, {len(ok)} on profile version {PROFILE_VERSION}")

    def level(p, dim):
        return ((p.get("dims") or {}).get(dim) or {}).get("level")

    # Half "edgy" (the AI put some dimension at 2+), half anything. A purely random pick of kids'
    # videos is nearly all zeros, which makes kappa meaningless. One video per channel overall.
    edgy = [v for v in ok if any((level(v[1], d) or 0) >= 2 for d in DIMS)]
    random.seed(42)
    channels = set()

    def pick(pool, k, taken):
        random.shuffle(pool)
        out = []
        for vid, p in pool:
            if len(out) == k:
                break
            ch = p.get("channelName", "")
            if vid in taken or ch in channels:
                continue
            out.append((vid, p)); channels.add(ch); taken.add(vid)
        return out

    taken = set()
    chosen = pick(edgy, n // 2, taken)
    chosen += pick(ok, n - len(chosen), taken)
    if len(chosen) < n:  # fewer channels than videos: allow repeats
        print(f"Only {len(channels)} channels: some appear more than once.")
        chosen += [v for v in ok if v[0] not in taken][: n - len(chosen)]
    random.shuffle(chosen)

    save_json(SAMPLE, [{"videoId": v, "title": p.get("title", ""), "channel": p.get("channelName", ""),
                        "basis": p.get("basis", "transcript")} for v, p in chosen])
    save_json(AI, {v: {d: level(p, d) for d in DIMS} for v, p in chosen})
    print(f"Picked {len(chosen)} videos ({min(len(edgy), n // 2)} where the AI rated something 2+).")
    print("Now run: python label_eval.py rate   (don't open ai_ratings.json)")


def load_human():
    if not os.path.exists(HUMAN):
        return {}
    with open(HUMAN, newline="", encoding="utf-8") as f:
        return {r["videoId"]: r for r in csv.DictReader(f)}


def rate():
    videos = load_json(SAMPLE)
    done = load_human()
    todo = [v for v in videos if v["videoId"] not in done]
    print(f"{len(done)}/{len(videos)} done. Skim each video; 0-4 per dimension, '?' = can't tell, q = quit.\n")
    new_file = not os.path.exists(HUMAN)
    with open(HUMAN, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["videoId", *DIMS, "note"])
        if new_file:
            w.writeheader()
        for i, v in enumerate(todo, len(done) + 1):
            print(f"[{i}/{len(videos)}] {v['title']}  ({v['channel']})")
            webbrowser.open(f"https://www.youtube.com/watch?v={v['videoId']}")
            row = {"videoId": v["videoId"]}
            for d in DIMS:
                while True:
                    a = input(f"  {d:12} {LADDERS[d]}\n  > ").strip().lower()
                    if a == "q":
                        print("Saved. Run rate again to continue.")
                        return
                    if a in {"0", "1", "2", "3", "4", "?"}:
                        row[d] = a
                        break
            row["note"] = input("  note (optional): ").strip()
            w.writerow(row); f.flush()
            print()
    print("All rated. Now run: python label_eval.py score")


def weighted_kappa(a, b, k=5):
    """Quadratic-weighted Cohen's kappa for two lists of ints in 0..k-1."""
    n = len(a)
    if n == 0:
        return None
    obs = [[0] * k for _ in range(k)]
    for x, y in zip(a, b):
        obs[x][y] += 1
    ra = [sum(r) for r in obs]
    cb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    num = den = 0.0
    for i in range(k):
        for j in range(k):
            wt = (i - j) ** 2 / (k - 1) ** 2
            num += wt * obs[i][j]
            den += wt * ra[i] * cb[j] / n
    return None if den == 0 else 1 - num / den  # den 0 = no variation, kappa undefined


def score():
    ai = load_json(AI)
    human = load_human()
    titles = {v["videoId"]: v for v in load_json(SAMPLE)}
    lines = [f"# Kideos labeling pilot: {len(human)} videos, 1 human rater\n",
             "Quadratic-weighted Cohen's kappa, AI vs human, on the 0-4 scales. Target >= 0.7.\n",
             "- The AI levels are what Kideos stores, so they include the code-applied floors (counted "
             "swearing, image moderation, known high-energy channels), not only the model's answer.",
             f"- Profiles from the current prompt only (profile version {PROFILE_VERSION}).",
             "- Sample: half picked where the AI rated some dimension 2+, half random, one video per channel. "
             "That over-represents non-zero videos on purpose, which tends to give a higher kappa than a "
             "typical mix of kids' videos would.",
             "- Per-video disagreements are kept out of the repo: no AI ratings of individual videos are "
             "published.\n",
             "| Dimension | n | Weighted kappa | Exact match | Within 1 | AI higher | AI lower |",
             "|---|---|---|---|---|---|---|"]
    all_a, all_h, gaps = [], [], []
    for d in DIMS:
        a, h = [], []
        for vid, r in human.items():
            x, y = ai.get(vid, {}).get(d), r[d]
            if x is None or y == "?":
                continue
            a.append(int(x)); h.append(int(y))
            gaps.append((abs(int(x) - int(y)), vid, d, int(x), int(y)))
        all_a += a; all_h += h
        n = len(a)
        k = weighted_kappa(h, a)
        pct = lambda c: f"{100 * c / n:.0f}%" if n else "-"
        lines.append(f"| {d} | {n} | {'n/a (no variation)' if k is None else f'{k:.2f}'} | "
                     f"{pct(sum(x == y for x, y in zip(a, h)))} | {pct(sum(abs(x - y) <= 1 for x, y in zip(a, h)))} | "
                     f"{pct(sum(x > y for x, y in zip(a, h)))} | {pct(sum(x < y for x, y in zip(a, h)))} |")
    k = weighted_kappa(all_h, all_a)
    lines.append(f"| **all (pooled)** | {len(all_a)} | {'n/a' if k is None else f'{k:.2f}'} | | | | |")
    out = "\n".join(lines) + "\n"
    with open(RESULTS, "w", encoding="utf-8") as f:
        f.write(out)

    lines = ["# Biggest disagreements (local only: don't commit)\n",
             "| Video | Dimension | AI | Human | Note |", "|---|---|---|---|---|"]
    for gap, vid, d, x, y in sorted(gaps, reverse=True)[:10]:
        if gap == 0:
            break
        v = titles.get(vid, {})
        lines.append(f"| [{v.get('title', vid)}](https://youtu.be/{vid}) | {d} | {x} | {y} | {human[vid].get('note', '')} |")
    dis = "\n".join(lines) + "\n"
    with open(DISAGREE, "w", encoding="utf-8") as f:
        f.write(dis)
    print(out)
    print(dis)
    print(f"Scores: {RESULTS} (commit this). Disagreements: {DISAGREE} (stays local).")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "sample":
        sample(int(sys.argv[2]) if len(sys.argv) > 2 else 40)
    elif cmd == "rate":
        rate()
    elif cmd == "score":
        score()
    else:
        print(__doc__)

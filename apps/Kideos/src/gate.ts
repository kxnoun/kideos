// ─────────────────────────────────────────────────────────────
// Kideos Kid App — when to ask "Who's watching?" again (devices with 2+ children)
//
// - A full restart (the app's process was killed / the phone rebooted) → always ask:
//   this lives in memory only, so it's gone.
// - Closed and reopened (Home, Back, screen off) → keep the same child if the app was
//   away less than the parent's setting (kidDevices.askWhoAfterMinutes: 0 = ask every
//   time, 1 / 5 / 10 / 20 / 30 min). React screens can be rebuilt on reopen, but this
//   module stays as long as the process does.
// ─────────────────────────────────────────────────────────────

const gate = {
  childId: null as string | null,
  leftAt: null as number | null, // when the app went to the background
  askWhoAfterMinutes: 5, // last known parent setting (the device doc may not be loaded yet)
};

export function setAskWhoMinutes(minutes: number): void {
  gate.askWhoAfterMinutes = minutes;
}

export function rememberChild(childId: string): void {
  gate.childId = childId;
  gate.leftAt = null;
}

export function forgetChild(): void {
  gate.childId = null;
  gate.leftAt = null;
}

export function markLeft(): void {
  if (gate.childId && gate.leftAt === null) gate.leftAt = Date.now();
}

// The child still picked, or null = ask again
export function stillChosen(askWhoAfterMinutes = gate.askWhoAfterMinutes): string | null {
  if (!gate.childId) return null;
  if (gate.leftAt === null) return gate.childId; // never left (screen rebuilt)
  const away = Date.now() - gate.leftAt;
  if (askWhoAfterMinutes > 0 && away < askWhoAfterMinutes * 60_000) {
    gate.leftAt = null;
    return gate.childId;
  }
  forgetChild();
  return null;
}

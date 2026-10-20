// ─────────────────────────────────────────────────────────────
// Kideos — who may use this server (self-hosted, docs/self-hosting.md)
//
// Open by default: anyone who can sign in to the parent app may use it. To share one
// server with friends and family only, create the Firestore doc instance/access with
// { inviteOnly: true } and one doc per person at members/{their sign-in email, lowercase}.
// firestore.rules enforces the same thing for reads and writes (isMember).
// ─────────────────────────────────────────────────────────────

import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

let cached: { inviteOnly: boolean; at: number } | null = null;

async function inviteOnly(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 60_000) return cached.inviteOnly;
  const snap = await getFirestore().doc("instance/access").get();
  cached = { inviteOnly: snap.exists && snap.get("inviteOnly") === true, at: Date.now() };
  return cached.inviteOnly;
}

/** Throws permission-denied for a signed-in user who isn't a member of an invite-only server. */
export async function assertMember(auth: { token: { email?: string } } | undefined): Promise<void> {
  if (!(await inviteOnly())) return;
  const email = auth?.token.email?.toLowerCase();
  if (email && (await getFirestore().doc(`members/${email}`).get()).exists) return;
  throw new HttpsError("permission-denied", "This Kideos server is invite-only");
}

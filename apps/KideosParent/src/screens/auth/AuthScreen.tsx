// ─────────────────────────────────────────────────────────────
// Kideos for Parents — AuthScreen
//
// Unified sign-in / sign-up screen.
// Priority: Google → Apple (iOS only) → email/password fallback.
// After any successful auth, onAuthStateChanged in App.tsx handles routing.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import {
  signIn,
  signUp,
  signInWithGoogle,
  signInWithApple,
} from "../../services/firebase";

type EmailMode = "signin" | "signup";
type LoadingState = "google" | "apple" | "email" | null;

const FIREBASE_ERRORS: Record<string, string> = {
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/weak-password": "Password is too weak. Please choose a stronger one.",
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/operation-not-allowed": "This sign-in method is not enabled.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
};

function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  return (
    (code && FIREBASE_ERRORS[code]) ??
    (e instanceof Error ? e.message : "Something went wrong.")
  );
}

export default function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mode, setMode] = useState<EmailMode>("signin");
  const [loading, setLoading] = useState<LoadingState>(null);

  const handleGoogle = useCallback(async () => {
    setLoading("google");
    try {
      await signInWithGoogle();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      // SIGN_IN_CANCELLED = user dismissed — not an error
      if (code !== "SIGN_IN_CANCELLED" && code !== "12501") {
        Alert.alert("Google Sign-In Failed", friendlyError(e));
      }
    } finally {
      setLoading(null);
    }
  }, []);

  const handleApple = useCallback(async () => {
    setLoading("apple");
    try {
      await signInWithApple();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      // 1001 = user cancelled Apple auth sheet
      if (code !== "1001") {
        Alert.alert("Apple Sign-In Failed", friendlyError(e));
      }
    } finally {
      setLoading(null);
    }
  }, []);

  const handleEmail = useCallback(async () => {
    if (!email.trim() || !password) {
      Alert.alert("Please fill in all fields.");
      return;
    }
    if (mode === "signup") {
      if (password.length < 8) {
        Alert.alert("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        Alert.alert("Passwords don't match.");
        return;
      }
    }
    setLoading("email");
    try {
      if (mode === "signup") {
        await signUp(email.trim(), password); // also creates the profile
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e: unknown) {
      Alert.alert(
        mode === "signup" ? "Sign Up Failed" : "Sign In Failed",
        friendlyError(e)
      );
    } finally {
      setLoading(null);
    }
  }, [email, password, confirm, mode]);

  const busy = loading !== null;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.logo}>Kideos</Text>
          <Text style={styles.tagline}>for Parents</Text>

          {/* ── Social sign-in ─────────────────────────────── */}
          <TouchableOpacity
            style={[styles.socialBtn, styles.googleBtn, busy && styles.disabled]}
            onPress={handleGoogle}
            disabled={busy}
            activeOpacity={0.8}
          >
            {loading === "google" ? (
              <ActivityIndicator color="#444" />
            ) : (
              <>
                <Text style={styles.googleG}>G</Text>
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS === "ios" && (
            <TouchableOpacity
              style={[styles.socialBtn, styles.appleBtn, busy && styles.disabled]}
              onPress={handleApple}
              disabled={busy}
              activeOpacity={0.8}
            >
              {loading === "apple" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.appleIcon}></Text>
                  <Text style={styles.appleText}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* ── Divider ────────────────────────────────────── */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ── Email / password form ──────────────────────── */}
          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#aaa"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={mode === "signup" ? "Min. 8 characters" : "••••••••"}
              placeholderTextColor="#aaa"
              secureTextEntry
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />

            {mode === "signup" && (
              <>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  style={styles.input}
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Re-enter password"
                  placeholderTextColor="#aaa"
                  secureTextEntry
                  autoComplete="new-password"
                />
              </>
            )}

            {/* ── Sign in / Create account toggle ─────────── */}
            <View style={styles.toggle}>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === "signin" && styles.toggleBtnActive]}
                onPress={() => setMode("signin")}
              >
                <Text
                  style={[
                    styles.toggleText,
                    mode === "signin" && styles.toggleTextActive,
                  ]}
                >
                  Sign in
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, mode === "signup" && styles.toggleBtnActive]}
                onPress={() => setMode("signup")}
              >
                <Text
                  style={[
                    styles.toggleText,
                    mode === "signup" && styles.toggleTextActive,
                  ]}
                >
                  Create account
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.btn, busy && styles.disabled]}
              onPress={handleEmail}
              disabled={busy}
              activeOpacity={0.8}
            >
              {loading === "email" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>
                  {mode === "signin" ? "Sign In" : "Create Account"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F7FF" },
  inner: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },

  logo: {
    fontSize: 40,
    fontWeight: "800",
    color: "#6C63FF",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: "#999",
    marginBottom: 40,
  },

  // Social buttons
  socialBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  googleBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  googleG: {
    fontSize: 17,
    fontWeight: "700",
    color: "#4285F4",
    marginRight: 10,
  },
  googleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  appleBtn: {
    backgroundColor: "#000",
  },
  appleIcon: {
    fontSize: 18,
    color: "#fff",
    marginRight: 10,
    lineHeight: 22,
  },
  appleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },

  // Divider
  divider: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E8E8F0",
  },
  dividerLabel: {
    marginHorizontal: 12,
    fontSize: 13,
    color: "#aaa",
  },

  // Email form
  form: { width: "100%" },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: "#1A1A2E",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E8E8F0",
  },

  // Sign in / Create account toggle
  toggle: {
    flexDirection: "row",
    backgroundColor: "#EDEDF8",
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  toggleBtnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#999",
  },
  toggleTextActive: {
    color: "#1A1A2E",
  },

  btn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  disabled: { opacity: 0.55 },
});

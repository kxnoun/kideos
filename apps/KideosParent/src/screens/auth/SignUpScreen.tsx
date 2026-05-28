// ─────────────────────────────────────────────────────────────
// Kideos for Parents — SignUpScreen
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
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types";
import { signUp, createUserProfile } from "../../services/firebase";

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, "SignUp">;
}

export default function SignUpScreen({ navigation }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = useCallback(async () => {
    if (!email.trim() || !password) {
      Alert.alert("Please fill in all fields.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const cred = await signUp(email.trim(), password);
      await createUserProfile(cred.user.uid, email.trim());
      // Auth state change in App.tsx triggers onboarding flow
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      const friendly: Record<string, string> = {
        "auth/email-already-in-use": "An account with this email already exists.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/weak-password": "Password is too weak. Please choose a stronger one.",
        "auth/network-request-failed": "Network error. Check your connection and try again.",
        "auth/operation-not-allowed": "Sign-up is currently unavailable. Please try again later.",
      };
      const msg = (code && friendly[code]) ?? (e instanceof Error ? e.message : "Could not create account.");
      Alert.alert("Sign Up Failed", msg);
    } finally {
      setLoading(false);
    }
  }, [email, password, confirm]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>Kideos</Text>
          <Text style={styles.tagline}>for Parents</Text>
          <Text style={styles.heading}>Create your account</Text>

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
              placeholder="Min. 8 characters"
              placeholderTextColor="#aaa"
              secureTextEntry
            />

            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Re-enter password"
              placeholderTextColor="#aaa"
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleSignUp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => navigation.navigate("SignIn")}>
            <Text style={styles.link}>
              Already have an account?{" "}
              <Text style={styles.linkBold}>Sign in</Text>
            </Text>
          </TouchableOpacity>
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
    marginBottom: 8,
  },
  heading: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 32,
  },
  form: { width: "100%", marginBottom: 24 },
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
  btn: {
    backgroundColor: "#6C63FF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  link: { fontSize: 14, color: "#666", textAlign: "center" },
  linkBold: { color: "#6C63FF", fontWeight: "700" },
});

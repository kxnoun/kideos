// ─────────────────────────────────────────────────────────────
// Kideos for Parents — Root component
//
// Navigation structure:
//   Not signed in          → Auth stack   (SignIn / SignUp)
//   Signed in, no children → Onboarding   (CreateChild → SetFilters → AddChannels)
//   Signed in, has children→ Main tabs     (Home / Channels / Digest / Settings)
//
// Children are loaded from Firestore in this component and
// synced to Zustand so all screens can read them.
// ─────────────────────────────────────────────────────────────

import React, { useEffect } from "react";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { useAuth } from "./src/hooks/useAuth";
import { useStore } from "./src/store/useStore";
import { subscribeToChildren } from "./src/services/firebase";

// Auth screens
import SignInScreen from "./src/screens/auth/SignInScreen";
import SignUpScreen from "./src/screens/auth/SignUpScreen";

// Onboarding screens
import CreateChildScreen from "./src/screens/onboarding/CreateChildScreen";
import SetFiltersScreen from "./src/screens/onboarding/SetFiltersScreen";
import AddChannelsScreen from "./src/screens/onboarding/AddChannelsScreen";

// Main tab screens
import HomeScreen from "./src/screens/main/HomeScreen";
import ChannelsScreen from "./src/screens/main/ChannelsScreen";
import DigestScreen from "./src/screens/main/DigestScreen";
import SettingsScreen from "./src/screens/main/SettingsScreen";

import type { RootStackParamList, MainTabParamList } from "./src/types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: "🏠",
    Channels: "📺",
    Digest: "📊",
    Settings: "⚙️",
  };
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>
      {icons[name] ?? "●"}
    </Text>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => (
          <TabIcon name={route.name} focused={focused} />
        ),
        tabBarLabel: route.name,
        tabBarActiveTintColor: "#6C63FF",
        tabBarInactiveTintColor: "#999",
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: "#E8E8F0",
          paddingBottom: 4,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Channels" component={ChannelsScreen} />
      <Tab.Screen name="Digest" component={DigestScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const user = useAuth(); // subscribes to Firebase Auth + syncs to store
  const childrenLoaded = useStore((s) => s.childrenLoaded);
  const inOnboarding = useStore((s) => s.inOnboarding);
  const setChildren = useStore((s) => s.setChildren);

  // undefined = onAuthStateChanged hasn't fired yet
  const isLoading = user === undefined;
  const isSignedIn = user !== null && user !== undefined;
  // Wait for auth AND the first Firestore snapshot before routing
  const showLoading = isLoading || (isSignedIn && !childrenLoaded);

  // Subscribe to children whenever user is signed in
  useEffect(() => {
    if (!isSignedIn || !user) return;
    // subscribeToChildren returns { id, profile }[] — same shape as ChildEntry
    const unsub = subscribeToChildren(user.uid, setChildren);
    return unsub;
  }, [isSignedIn, user, setChildren]);

  if (showLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!isSignedIn ? (
            // ── Auth stack ──────────────────────────────────────
            <>
              <Stack.Screen name="SignIn" component={SignInScreen} />
              <Stack.Screen name="SignUp" component={SignUpScreen} />
            </>
          ) : inOnboarding ? (
            // ── Onboarding stack ─────────────────────────────────
            // inOnboarding stays true until AddChannelsScreen calls completeOnboarding().
            // This prevents mid-onboarding stack swaps when the first child saves to Firestore.
            <>
              <Stack.Screen name="CreateChild" component={CreateChildScreen} />
              <Stack.Screen name="SetFilters" component={SetFiltersScreen} />
              <Stack.Screen name="AddChannels" component={AddChannelsScreen} />
            </>
          ) : (
            // ── Main app ────────────────────────────────────────
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              {/* Also available for adding new child profiles from Settings */}
              <Stack.Screen name="CreateChild" component={CreateChildScreen} />
              <Stack.Screen name="SetFilters" component={SetFiltersScreen} />
              <Stack.Screen name="AddChannels" component={AddChannelsScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F7FF",
  },
});

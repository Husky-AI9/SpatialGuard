import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { request, restore, save, ORIGIN } from "./src/api";
import { Button, Label, Mark, colors, styles as s } from "./src/ui";
import Workspace from "./src/Workspace";
import WelcomeArt from "./src/WelcomeArt";
export default function App() {
  const [fonts, fontError] = useFonts({
    SourceSans: require("./assets/fonts/source-sans-3-400.ttf"),
    SourceSansBold: require("./assets/fonts/source-sans-3-700.ttf"),
  });
  const [ready, setReady] = useState(false),
    [signed, setSigned] = useState(false),
    [page, setPage] = useState<
      "landing" | "signin" | "signup" | "forgot" | "workspace"
    >("landing");
  useEffect(() => {
    restore()
      .then(setSigned)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: page === "landing" ? colors.purple : colors.page,
        }}
      >
        <StatusBar style={page === "landing" ? "light" : "dark"} />
        {!ready || (!fonts && !fontError) ? (
          <ActivityIndicator style={{ flex: 1 }} color={colors.purple} />
        ) : page === "landing" ? (
          <View
            style={{ flex: 1, padding: 28, justifyContent: "space-between" }}
          >
            <View style={s.row}>
              <Mark color="white" />
              <Label style={[s.title, { color: "white" }]}>SpatialGuard</Label>
            </View>
            <View style={{ alignItems: "center", gap: 20 }}>
              <WelcomeArt />
              <Label
                style={{
                  fontSize: 28,
                  color: "white",
                  fontFamily: "SourceSansBold",
                  textAlign: "center",
                }}
              >
                See what happened.{"\n"}Know where.
              </Label>
              <Label style={{ color: "white", textAlign: "center" }}>
                Your cameras, home map, and incident evidence together.
              </Label>
            </View>
            <View style={{ gap: 12 }}>
              <Button title="Try it out" onPress={() => setPage(signed ? "workspace" : "signin")} />
              <Pressable
                accessibilityRole="button"
                style={[s.button, { backgroundColor: "white" }]}
                onPress={() => setPage(signed ? "workspace" : "signin")}
              >
                <Label
                  style={{ color: colors.purple, fontFamily: "SourceSansBold" }}
                >
                  {signed ? "Open SpatialGuard" : "Sign in"}
                </Label>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={[s.button, { borderWidth: 1, borderColor: "white" }]}
                onPress={() => setPage("signup")}
              >
                <Label style={s.buttonText}>Create account</Label>
              </Pressable>
            </View>
          </View>
        ) : page !== "workspace" ? (
          <Auth
            mode={page}
            onBack={() => setPage("landing")}
            change={setPage}
            done={() => {
              setSigned(true);
              setPage("workspace");
            }}
          />
        ) : (
          <Workspace
            onSignout={() => {
              setSigned(false);
              setPage("landing");
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
function Auth({
  mode,
  onBack,
  change,
  done,
}: {
  mode: "signin" | "signup" | "forgot";
  onBack: () => void;
  change: (m: "signin" | "signup" | "forgot") => void;
  done: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (mode === "forgot") {
        const r = await request<{ message: string }>(
          "/v1/auth/password/request",
          "POST",
          { email },
        );
        setMessage(r.message);
        return;
      }
      if (mode === "signup" && confirm !== password)
        throw new Error("Passwords do not match.");
      const r = await request<{ token: string | null }>(
        "/v1/auth/" + mode,
        "POST",
        { email: email.trim(), password },
      );
      if (!r.token) throw new Error("A mobile session was not returned.");
      await save(r.token);
      setPassword("");
      done();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.content,
          { flexGrow: 1, justifyContent: "center" },
        ]}
      >
        <Button title="Back" onPress={onBack} />
        <Mark size={48} />
        <Label style={s.title}>
          {mode === "signin"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : "Reset password"}
        </Label>
        <Label>Email</Label>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          style={s.input}
        />
        {mode !== "forgot" && (
          <>
            <Label>Password</Label>
            <TextInput
              accessibilityLabel="Password"
              secureTextEntry
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChangeText={setPassword}
              style={s.input}
            />
          </>
        )}
        {mode === "signup" && (
          <>
            <Label>Confirm password</Label>
            <TextInput
              accessibilityLabel="Confirm password"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              style={s.input}
            />
          </>
        )}
        {!!message && <Label accessibilityRole="alert">{message}</Label>}
        <Button
          title={
            busy
              ? "Please wait…"
              : mode === "forgot"
                ? "Send reset link"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"
          }
          disabled={
            busy || !email || (mode !== "forgot" && password.length < 8)
          }
          onPress={() => void submit()}
        />
        <Button
          title={mode === "signin" ? "Forgot password?" : "Back to sign in"}
          onPress={() => {
            setMessage("");
            change(mode === "signin" ? "forgot" : "signin");
          }}
        />
        <Label
          onPress={() => void Linking.openURL(ORIGIN + "/privacy")}
          style={s.muted}
        >
          Privacy policy
        </Label>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

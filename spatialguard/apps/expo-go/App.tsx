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
import { Button, Icon, Label, Mark, colors, styles as s } from "./src/ui";
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
        // The workspace tab bar paints under the home indicator itself.
        edges={page === "landing" || page === "workspace" ? ["top", "left", "right"] : undefined}
        style={{
          flex: 1,
          backgroundColor: page === "landing" ? colors.purple : colors.page,
        }}
      >
        <StatusBar style={page === "landing" ? "light" : "dark"} />
        {!ready || (!fonts && !fontError) ? (
          <ActivityIndicator style={{ flex: 1 }} color={colors.purple} />
        ) : page === "landing" ? (
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16, alignItems: "center" }}>
              <View style={[s.row, { gap: 10 }]}>
                <Mark color="white" size={30} />
                <Label style={[s.title, { color: "white" }]}>SpatialGuard</Label>
              </View>
              <View style={{ flex: 1, justifyContent: "center", width: "100%", alignItems: "center" }}>
                <WelcomeArt />
              </View>
            </View>
            <View style={{ backgroundColor: colors.page, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 36, gap: 12 }}>
              <Label style={{ textAlign: "center", color: colors.muted, fontFamily: "SourceSansBold", fontSize: 12, letterSpacing: 1.2 }}>
                WELCOME TO SPATIALGUARD
              </Label>
              <Label style={{ fontSize: 30, lineHeight: 34, fontFamily: "SourceSansBold", textAlign: "center", color: colors.ink }}>
                See what happened.{"\n"}
                <Label style={{ fontSize: 30, fontFamily: "SourceSansBold", color: colors.purple }}>Know where.</Label>
              </Label>
              <Label style={{ color: colors.muted, textAlign: "center", fontSize: 15 }}>
                Your cameras, movement, and evidence in one clear home view.
              </Label>
              <Button icon="play" title={signed ? "Open SpatialGuard" : "Try it out"} onPress={() => setPage(signed ? "workspace" : "signin")} style={{ marginTop: 6 }} />
              {!signed && (
                <View style={s.row}>
                  <Button variant="secondary" title="Sign in" onPress={() => setPage("signin")} style={{ flex: 1 }} />
                  <Button variant="secondary" title="Sign up" onPress={() => setPage("signup")} style={{ flex: 1, backgroundColor: colors.purpleSoft, borderColor: "#c9c3f7" }} />
                </View>
              )}
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
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={[s.row, { gap: 6, alignSelf: "flex-start", paddingVertical: 6 }]}>
          <Icon name="back" size={18} />
          <Label style={s.strong}>Back</Label>
        </Pressable>
        <Mark size={44} />
        <Label style={s.title}>
          {mode === "signin"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : "Reset password"}
        </Label>
        <Label style={s.strong}>Email</Label>
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
            <Label style={s.strong}>Password</Label>
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
            <Label style={s.strong}>Confirm password</Label>
            <TextInput
              accessibilityLabel="Confirm password"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              style={s.input}
            />
          </>
        )}
        {!!message && <Label accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>{message}</Label>}
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
          variant="ghost"
          title={mode === "signin" ? "Forgot password?" : "Back to sign in"}
          onPress={() => {
            setMessage("");
            change(mode === "signin" ? "forgot" : "signin");
          }}
        />
        <Label
          onPress={() => void Linking.openURL(ORIGIN + "/privacy")}
          style={{ color: colors.purple, fontFamily: "SourceSansBold", fontSize: 14, textAlign: "center" }}
        >
          Privacy policy
        </Label>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

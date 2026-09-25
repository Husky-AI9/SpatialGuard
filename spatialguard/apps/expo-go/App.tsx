import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewErrorEvent, type WebViewNavigation } from "react-native-webview";

const HOSTED_ORIGIN = "https://spatialguard-production.up.railway.app";
const START_URL = `${HOSTED_ORIGIN}/landing`;

export default function App() {
  const [key, setKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    setError("");
    setLoading(true);
    setKey((current) => current + 1);
  }, []);

  const allowNavigation = useCallback((request: WebViewNavigation) => {
    if (request.url.startsWith(HOSTED_ORIGIN)) return true;
    void Linking.openURL(request.url);
    return false;
  }, []);

  const handleError = useCallback((event: WebViewErrorEvent) => {
    setLoading(false);
    setError(event.nativeEvent.description || "The hosted workspace could not be reached.");
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {error ? (
        <View style={styles.errorState}>
          <Text style={styles.mark}>SG</Text>
          <Text style={styles.title}>SpatialGuard is offline</Text>
          <Text style={styles.message}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.webViewFrame}>
          <WebView
            key={key}
            source={{ uri: START_URL }}
            originWhitelist={[`${HOSTED_ORIGIN}/*`]}
            onShouldStartLoadWithRequest={allowNavigation}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={handleError}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            pullToRefreshEnabled={Platform.OS === "ios"}
            setSupportMultipleWindows={false}
            style={styles.webView}
          />
          {loading && (
            <View pointerEvents="none" style={styles.loadingState}>
              <ActivityIndicator color="#5b4fe8" size="large" />
              <Text style={styles.loadingText}>Opening SpatialGuard…</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f2f3fa" },
  webViewFrame: { flex: 1, overflow: "hidden" },
  webView: { flex: 1, backgroundColor: "#f2f3fa" },
  loadingState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#f2f3fa",
  },
  loadingText: { color: "#5b607f", fontSize: 15, fontWeight: "600" },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: "#f2f3fa",
  },
  mark: {
    width: 64,
    height: 64,
    marginBottom: 20,
    paddingTop: 18,
    borderRadius: 20,
    color: "#fff",
    backgroundColor: "#5b4fe8",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  title: { color: "#23253f", fontSize: 22, fontWeight: "800", textAlign: "center" },
  message: { maxWidth: 320, marginTop: 10, color: "#5b607f", lineHeight: 22, textAlign: "center" },
  retry: {
    marginTop: 24,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: "#5b4fe8",
  },
  retryText: { color: "#fff", fontWeight: "700" },
});

import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B100F" }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0B100F" } }} />
    </SafeAreaView>
  );
}

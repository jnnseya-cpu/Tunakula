import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SessionProvider, useSession } from "./state/session";
import { configurePushHandler } from "./push";
import { colors } from "./theme";
import type { RootStackParamList } from "./navigation";
import SignInScreen from "./screens/SignInScreen";
import DashboardScreen from "./screens/DashboardScreen";
import JobScreen from "./screens/JobScreen";
import EarningsScreen from "./screens/EarningsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.paper, card: colors.paper, text: colors.ink, primary: colors.orange, border: colors.line },
};

const headerOptions = {
  headerStyle: { backgroundColor: colors.paper },
  headerTintColor: colors.ink,
  headerTitleStyle: { fontWeight: "800" as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.paper },
};

function Gate() {
  const { session, ready } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}>
        <ActivityIndicator color={colors.orange} size="large" />
      </View>
    );
  }
  if (!session) return <SignInScreen />;
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Tunakula Rider" }} />
      <Stack.Screen name="Job" component={JobScreen} options={{ title: "Delivery" }} />
      <Stack.Screen name="Earnings" component={EarningsScreen} options={{ title: "Earnings" }} />
    </Stack.Navigator>
  );
}

export default function App() {
  useEffect(() => {
    configurePushHandler();
  }, []);
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <NavigationContainer theme={navTheme}>
          <Gate />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

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
import BoardScreen from "./screens/BoardScreen";
import OrderScreen from "./screens/OrderScreen";

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
      <Stack.Screen name="Board" component={BoardScreen} options={{ title: "Kitchen" }} />
      <Stack.Screen name="Order" component={OrderScreen} options={({ route }) => ({ title: `#${route.params.order.ref}` })} />
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

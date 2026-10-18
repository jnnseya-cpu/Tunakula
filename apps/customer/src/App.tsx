import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SessionProvider, useSession } from "./state/session";
import { CartProvider } from "./state/cart";
import { configurePushHandler } from "./push";
import { colors } from "./theme";
import type { RootStackParamList } from "./navigation";
import SignInScreen from "./screens/SignInScreen";
import HomeScreen from "./screens/HomeScreen";
import MenuScreen from "./screens/MenuScreen";
import CartScreen from "./screens/CartScreen";
import TrackScreen from "./screens/TrackScreen";
import OrdersScreen from "./screens/OrdersScreen";

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
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Tunakula" }} />
      <Stack.Screen name="Menu" component={MenuScreen} options={({ route }) => ({ title: route.params.branchName })} />
      <Stack.Screen name="Cart" component={CartScreen} options={{ title: "Your order" }} />
      <Stack.Screen name="Track" component={TrackScreen} options={{ title: "Track order" }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: "Your orders" }} />
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
        <CartProvider>
          <StatusBar style="dark" />
          <NavigationContainer theme={navTheme}>
            <Gate />
          </NavigationContainer>
        </CartProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

import type { NativeStackScreenProps } from "@react-navigation/native-stack";

/** The app's screen graph and the params each screen takes. */
export type RootStackParamList = {
  Home: undefined;
  Menu: { branchId: string; branchName: string };
  Cart: undefined;
  Track: { orderId: string };
  Orders: undefined;
};

export type Screen<K extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, K>;

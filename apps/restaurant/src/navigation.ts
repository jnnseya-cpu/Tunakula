import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { KitchenOrder } from "./api/types";

export type RootStackParamList = {
  Board: undefined;
  Order: { order: KitchenOrder };
};

export type Screen<K extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, K>;

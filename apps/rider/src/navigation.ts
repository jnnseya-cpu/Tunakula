import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Job } from "./api/types";

export type RootStackParamList = {
  Dashboard: undefined;
  Job: { job: Job };
  Earnings: undefined;
};

export type Screen<K extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, K>;

export interface PolicySection {
  readonly h: string;
  readonly p: readonly string[];
}

export interface Policy {
  readonly slug: string;
  readonly title: string;
  readonly audience: string;
  readonly summary: string;
  readonly sections: readonly PolicySection[];
}

/**
 * The menu-writer port (§AI): the generative half of the merchant copilot. Unlike the copilot's insights — which
 * the deterministic brain can produce — writing a dish description or translating one genuinely needs a language
 * model, so this port is backed by a hosted model with a template fallback. It only ever *suggests* text; the
 * merchant reviews it and chooses to save it. It is grounded in the real dish (its name, category and existing
 * text) and never invents menu facts like price or availability.
 */
export type WriteTask = "DESCRIBE" | "TRANSLATE";

export interface MenuWriteInput {
  readonly task: WriteTask;
  /** The dish name in the source language. */
  readonly name: string;
  readonly category?: string;
  readonly cuisines?: readonly string[];
  /** For DESCRIBE, the dish's existing description (may be empty); for TRANSLATE, the text to translate. */
  readonly sourceText: string;
  readonly fromLang: "fr" | "en";
  readonly toLang: "fr" | "en";
}

export interface MenuWriteResult {
  /** The suggested text. Empty means the writer could not produce it (e.g. a translation with no model configured). */
  readonly text: string;
  /** Where it came from: a hosted model, or the offline template fallback. Shown to the merchant. */
  readonly source: "ai" | "template";
}

export interface MenuWriterBrain {
  readonly id: string;
  write(input: MenuWriteInput): Promise<MenuWriteResult>;
}

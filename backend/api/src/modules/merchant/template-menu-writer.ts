/**
 * The offline menu writer. It can compose a basic dish description from the grounded facts (name, category,
 * cuisines) without a model, so a merchant always gets a starting point. It cannot translate — that genuinely
 * needs a language model — so a TRANSLATE task returns empty text, which the service turns into a clear
 * "connect the AI key" message. Used on its own with no key, and as the fallback inside the LLM writer.
 */
import type { MenuWriteInput, MenuWriteResult, MenuWriterBrain } from "@tunakula/ts-contracts";

export class TemplateMenuWriter implements MenuWriterBrain {
  readonly id = "template";

  async write(input: MenuWriteInput): Promise<MenuWriteResult> {
    if (input.task === "TRANSLATE") return { text: "", source: "template" };
    const name = input.name.trim();
    if (!name) return { text: "", source: "template" };
    const cat = (input.category ?? "").trim();
    const en = cat ? `${name} — a ${cat.toLowerCase()} favourite, freshly prepared to order.` : `${name}, freshly prepared to order.`;
    const fr = cat ? `${name} — une spécialité ${cat.toLowerCase()} préparée à la commande.` : `${name}, préparé à la commande.`;
    return { text: input.toLang === "en" ? en : fr, source: "template" };
  }
}

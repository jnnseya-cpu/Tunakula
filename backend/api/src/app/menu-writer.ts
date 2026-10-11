/**
 * The menu-writer service (§AI): the generative side of the merchant copilot. For a dish the merchant manages,
 * it drafts a description or translates one through the writer brain and returns the suggestion. It writes
 * nothing — the merchant reviews the text and saves it through the normal menu editor. Access is the branch's
 * own (menu:write), it is grounded in the real dish, and every suggestion is audited.
 */
import type { MenuWriteInput, MenuWriterBrain, WriteTask } from "@tunakula/ts-contracts";
import type { Db, Sql } from "../db/db.ts";
import type { CountryConfigRegistry } from "../modules/config/config-registry.ts";
import type { CatalogueService } from "./catalogue.ts";
import { authorize, type Principal, type ResourceContext } from "../modules/identity/policy.ts";
import { audit } from "../persistence/identity.ts";
import { badRequest, forbidden, notFound, unprocessable } from "./errors.ts";

interface BranchRow { id: string; name: string; brand_id: string; restaurant_group_id: string; city: string | null; commune: string | null }
interface MenuItem { id: string; names: Record<string, string>; description?: Record<string, string>; category?: string | null; tags?: string[] }

export class MenuWriterService {
  private readonly db: Db;
  private readonly registry: CountryConfigRegistry;
  private readonly catalogue: CatalogueService;
  private readonly brain: MenuWriterBrain;

  constructor(db: Db, registry: CountryConfigRegistry, catalogue: CatalogueService, brain: MenuWriterBrain) {
    this.db = db; this.registry = registry; this.catalogue = catalogue; this.brain = brain;
  }

  async suggest(country: string, principal: Principal, branchId: string, itemId: string, input: { task: string; toLang?: string }) {
    const v = this.registry.published(country);
    if (!v) throw forbidden("Unknown market");
    const task = (input.task ?? "").toUpperCase();
    if (task !== "DESCRIBE" && task !== "TRANSLATE") throw badRequest("BAD_TASK", "task must be DESCRIBE or TRANSLATE");
    const toLang: "fr" | "en" = input.toLang === "en" ? "en" : "fr";
    const fromLang: "fr" | "en" = toLang === "en" ? "fr" : "en";

    const branch = await this.db.tx({ country }, (sql) => loadBranch(sql, branchId));
    if (!branch) throw notFound("Branch");
    const resource: ResourceContext = {
      type: "menu", country, brandId: branch.brand_id, branchId: branch.id, restaurantGroupId: branch.restaurant_group_id,
      ...(branch.city ? { cityId: branch.city } : {}), ...(branch.commune ? { zoneIds: [branch.commune] } : {}),
    };
    if (!authorize(principal, "menu:write", resource, { activeCountry: country, profile: v.profile }).allowed) throw forbidden("You can't edit this branch's menu");

    const menu = (await this.catalogue.menu(country, branchId)) as { items: MenuItem[] };
    const item = (menu.items ?? []).find((i) => i.id === itemId);
    if (!item) throw notFound("Dish");

    const name = item.names[toLang] ?? item.names["fr"] ?? item.names["en"] ?? "";
    let sourceText: string;
    if (task === "TRANSLATE") {
      sourceText = (item.description?.[fromLang] ?? "").trim() || (item.names[fromLang] ?? "").trim();
      if (!sourceText) throw unprocessable("NOTHING_TO_TRANSLATE", `No ${fromLang.toUpperCase()} text to translate on this dish`);
    } else {
      sourceText = (item.description?.[toLang] ?? "").trim();
    }

    const writeInput: MenuWriteInput = {
      task: task as WriteTask, name, sourceText, fromLang: task === "TRANSLATE" ? fromLang : toLang, toLang,
      ...(item.category ? { category: item.category } : {}),
      ...(item.tags && item.tags.length ? { cuisines: item.tags } : {}),
    };
    const result = await this.brain.write(writeInput);
    if (!result.text.trim()) {
      // The offline template can't translate; tell the merchant how to enable it.
      throw unprocessable("AI_WRITER_UNAVAILABLE", task === "TRANSLATE"
        ? "Connect the AI assistant key in Admin → Integrations to translate dishes."
        : "Couldn't draft a description for this dish.");
    }

    await this.db.tx({ country }, async (sql) => {
      await audit(sql, { actor: principal.userId, action: "menu.ai_draft", target: `item:${itemId}`, country, detail: { task, toLang, source: result.source } });
    });

    return { task, to_lang: toLang, suggestion: result.text, source: result.source };
  }
}

async function loadBranch(sql: Sql, branchId: string): Promise<BranchRow | null> {
  return (await sql.query<BranchRow & Record<string, unknown>>("SELECT id, name, brand_id, restaurant_group_id, city, commune FROM catalogue.branch WHERE id = $1", [branchId]))[0] ?? null;
}

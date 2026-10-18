"use client";
/**
 * The full dish editor, shared by the menu panel and the self-serve onboarding wizard so a merchant
 * adds a food the same way everywhere: name and description per language, category, price, veg flag,
 * recommended, age-restriction, tags, allergens, dietary flags, nutrition, variations and add-ons.
 * One source of truth — the wizard's "add a dish" is the menu panel's "add a dish".
 */
import { useState } from "react";
import { API_BASE, api } from "../lib/api";
import type { Lang } from "../lib/i18n";

export interface FormVariation { name: string; type: "SINGLE" | "MULTI"; required: boolean; options: { name: string; price: string }[] }
export interface FormAddon { name: string; price: string }

/** The public URL of a food photo, for an <img src>. Country goes in the query so no header is needed. */
export const foodPhotoUrl = (imageId: string, country: string) => `${API_BASE}/v1/menu-images/${imageId}?c=${country}`;

export const DIETARY = ["VEGETARIAN", "VEGAN", "HALAL", "KOSHER", "GLUTEN_FREE", "DAIRY_FREE", "NUT_FREE", "ORGANIC", "SPICY"] as const;
export const DIETARY_LABEL: Record<string, [string, string]> = {
  VEGETARIAN: ["Végétarien", "Vegetarian"], VEGAN: ["Végétalien", "Vegan"], HALAL: ["Halal", "Halal"], KOSHER: ["Casher", "Kosher"],
  GLUTEN_FREE: ["Sans gluten", "Gluten-free"], DAIRY_FREE: ["Sans lactose", "Dairy-free"], NUT_FREE: ["Sans fruits à coque", "Nut-free"], ORGANIC: ["Bio", "Organic"], SPICY: ["Épicé", "Spicy"],
};
export const CATEGORIES = ["Restaurant", "Cuisine Locale", "Fast Food", "Boisson", "Dessert", "Végétarienne", "Accompagnements", "Fruits et Légumes", "Viande et Poisson", "Boulangeries", "Pizzérias", "Taco", "Menu Enfant", "Supermarché", "Épiceries", "Essentiel", "Promo"];

export const blankDish = () => ({ id: "", name_fr: "", name_en: "", desc_fr: "", category: "", price: "", unit_label: "", veg: "" as "" | "veg" | "non", recommended: false, age_restricted: false, tags: "", allergens: "", dietary: [] as string[], kcal: "", protein_g: "", carbs_g: "", fat_g: "", image_id: "", variations: [] as FormVariation[], addons: [] as FormAddon[], availability_hours: {} as Record<string, [string, string][]> });
export type DishFormValue = ReturnType<typeof blankDish>;

/** Weekday rows for the availability editor, Monday first; the number is the schedule key (0=Sunday). */
const WEEK_DAYS: [number, string, string][] = [[1, "Lun", "Mon"], [2, "Mar", "Tue"], [3, "Mer", "Wed"], [4, "Jeu", "Thu"], [5, "Ven", "Fri"], [6, "Sam", "Sat"], [0, "Dim", "Sun"]];

/** Builds the item-create/update API body from the form, in the given settlement currency. */
export function dishPayload(form: DishFormValue, settlement: string) {
  const names: Record<string, string> = {};
  if (form.name_fr.trim()) names.fr = form.name_fr.trim();
  if (form.name_en.trim()) names.en = form.name_en.trim();
  return {
    names,
    ...(form.desc_fr.trim() ? { description: { fr: form.desc_fr.trim() } } : { description: {} }),
    prices: { [settlement]: form.price.trim() },
    category: form.category.trim() || null,
    unit_label: form.unit_label.trim() || null,
    veg: form.veg === "veg" ? true : form.veg === "non" ? false : null,
    recommended: form.recommended,
    age_restricted: form.age_restricted,
    tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    allergens: form.allergens.split(",").map((t) => t.trim()).filter(Boolean),
    dietary: form.dietary,
    nutrition: Object.fromEntries((["kcal", "protein_g", "carbs_g", "fat_g"] as const).flatMap((k) => (form[k].trim() ? [[k, Number(form[k])]] : []))),
    image_id: form.image_id || null,
    variations: form.variations.filter((v) => v.name.trim() && v.options.some((o) => o.name.trim())).map((v) => ({
      name: v.name.trim(), type: v.type, required: v.required,
      options: v.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), price: o.price.trim() || "0" })),
    })),
    addons: form.addons.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), price: a.price.trim() || "0" })),
    // Dayparting: {} = always available; otherwise the weekday windows the dish is orderable.
    availability_hours: form.availability_hours ?? {},
  };
}

type Setter = (f: DishFormValue) => void;
interface Props { form: DishFormValue; setForm: Setter; settlement: string; lang: Lang; country: string; L: (fr: string, en: string) => string }

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("read failed"));
  r.readAsDataURL(file);
});

/** Upload and preview a food photo. The file goes to the shared media store under the public MENU_ITEM purpose. */
function DishPhoto({ form, setForm, country, L }: { form: DishFormValue; setForm: Setter; country: string; L: (fr: string, en: string) => string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File) => {
    setErr(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setErr(L("JPEG, PNG ou WebP uniquement.", "JPEG, PNG or WebP only.")); return; }
    if (file.size > 600_000) { setErr(L("Image trop lourde (max 600 Ko).", "Image too large (max 600 kB).")); return; }
    setBusy(true);
    try {
      const data_base64 = await fileToBase64(file);
      const r = await api<{ id: string }>("/v1/media", { method: "POST", country, body: { purpose: "MENU_ITEM", content_type: file.type, data_base64 } });
      setForm({ ...form, image_id: r.id });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="wide dish-photo">
      <span className="ff-label">{L("Photo du plat", "Food photo")}</span>
      <div className="dish-photo-row">
        {form.image_id ? <img className="dish-photo-img" src={foodPhotoUrl(form.image_id, country)} alt="" /> : <div className="dish-photo-empty" aria-hidden>🍽️</div>}
        <div className="dish-photo-actions">
          <label className="btn ghost sm">{busy ? "…" : form.image_id ? L("Changer la photo", "Change photo") : L("Téléverser une photo", "Upload a photo")}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
          </label>
          {form.image_id ? <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, image_id: "" })}>{L("Retirer", "Remove")}</button> : null}
          <small className="muted">{L("JPEG/PNG/WebP, max 600 Ko", "JPEG/PNG/WebP, max 600 kB")}</small>
        </div>
      </div>
      {err ? <p className="form-error small">{err}</p> : null}
    </div>
  );
}

/** The scalar fields of a dish (name, description, category, price, flags, dietary, nutrition). */
export function DishFields({ form, setForm, settlement, lang, country, L }: Props) {
  return (
    <div className="ff">
      <DishPhoto form={form} setForm={setForm} country={country} L={L} />
      <label>{L("Nom (FR)", "Name (FR)")}<input className="input" value={form.name_fr} onChange={(e) => setForm({ ...form, name_fr: e.target.value })} /></label>
      <label>{L("Nom (EN)", "Name (EN)")}<input className="input" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></label>
      <label className="wide">{L("Description (FR)", "Description (FR)")}<textarea className="input" rows={2} value={form.desc_fr} onChange={(e) => setForm({ ...form, desc_fr: e.target.value })} /></label>
      <label>{L("Catégorie", "Category")}<input className="input" list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><datalist id="cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></label>
      <label>{L("Prix", "Price")} ({settlement})<input className="input" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
      <label>{L("Unité (épicerie)", "Unit (grocery)")}<input className="input" value={form.unit_label} onChange={(e) => setForm({ ...form, unit_label: e.target.value })} placeholder={L("ex. 1 kg, 500 ml, pack de 6", "e.g. 1 kg, 500 ml, 6-pack")} maxLength={40} /></label>
      <label>{L("Type", "Type")}<select className="select" value={form.veg} onChange={(e) => setForm({ ...form, veg: e.target.value as DishFormValue["veg"] })}><option value="">—</option><option value="veg">{L("Végétarien", "Veg")}</option><option value="non">{L("Non végétarien", "Non-veg")}</option></select></label>
      <label className="chk"><input type="checkbox" checked={form.recommended} onChange={(e) => setForm({ ...form, recommended: e.target.checked })} /> {L("Recommandé", "Recommended")}</label>
      <label className="chk"><input type="checkbox" checked={form.age_restricted} onChange={(e) => setForm({ ...form, age_restricted: e.target.checked })} /> {L("Réservé aux 18+ (alcool)", "Age-restricted (18+)")}</label>
      <label>{L("Balises (séparées par des virgules)", "Tags (comma-separated)")}<input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
      <label>{L("Allergènes (virgules)", "Allergens (commas)")}<input className="input" value={form.allergens} onChange={(e) => setForm({ ...form, allergens: e.target.value })} /></label>
      <div className="wide">
        <span className="ff-label">{L("Régimes", "Dietary")}</span>
        <div className="chips">
          {DIETARY.map((d) => {
            const on = form.dietary.includes(d);
            return <button type="button" key={d} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setForm({ ...form, dietary: on ? form.dietary.filter((x) => x !== d) : [...form.dietary, d] })}>{DIETARY_LABEL[d]?.[lang === "fr" ? 0 : 1] ?? d}</button>;
          })}
        </div>
      </div>
      <div className="wide">
        <span className="ff-label">{L("Valeurs nutritionnelles (par portion)", "Nutrition (per serving)")}</span>
        <div className="nutri">
          {(["kcal", "protein_g", "carbs_g", "fat_g"] as const).map((k) => (
            <label key={k} className="nutri-f">{k === "kcal" ? "kcal" : k === "protein_g" ? L("Protéines g", "Protein g") : k === "carbs_g" ? L("Glucides g", "Carbs g") : L("Lipides g", "Fat g")}
              <input className="input" inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value.replace(/[^0-9.]/g, "") })} />
            </label>
          ))}
        </div>
      </div>
      <AvailabilityEditor form={form} setForm={setForm} lang={lang} L={L} />
    </div>
  );
}

/** Dayparting editor: when a dish is available (always, or only in a weekly window — breakfast, lunch…). */
function AvailabilityEditor({ form, setForm, lang, L }: { form: DishFormValue; setForm: Setter; lang: Lang; L: (fr: string, en: string) => string }) {
  const hours = form.availability_hours ?? {};
  const scheduled = Object.keys(hours).length > 0;
  const setDay = (d: number, window: [string, string] | null) => {
    const next: Record<string, [string, string][]> = { ...hours };
    if (window) next[String(d)] = [window]; else delete next[String(d)];
    setForm({ ...form, availability_hours: next });
  };
  const enableSchedule = (on: boolean) => {
    // Turning scheduling on seeds a sensible breakfast window on every day; off clears it (always available).
    setForm({ ...form, availability_hours: on ? Object.fromEntries(WEEK_DAYS.map(([d]) => [String(d), [["07:00", "11:00"]]])) : {} });
  };
  return (
    <div className="wide">
      <span className="ff-label">{L("Disponibilité horaire (dayparting)", "Time availability (dayparting)")}</span>
      <label className="chk"><input type="checkbox" checked={!scheduled} onChange={(e) => enableSchedule(!e.target.checked)} /> {L("Disponible à toute heure (quand l'établissement est ouvert)", "Available any time (while the branch is open)")}</label>
      {scheduled ? (
        <div className="avail-grid">
          {WEEK_DAYS.map(([d, fr, en]) => {
            const w = hours[String(d)]?.[0];
            return (
              <div className="avail-row" key={d}>
                <label className="chk"><input type="checkbox" checked={!!w} onChange={(e) => setDay(d, e.target.checked ? ["07:00", "11:00"] : null)} /> <span className="avail-day">{lang === "fr" ? fr : en}</span></label>
                {w ? (
                  <span className="avail-times">
                    <input type="time" className="input" value={w[0]} onChange={(e) => setDay(d, [e.target.value || "00:00", w[1]])} />
                    <span>→</span>
                    <input type="time" className="input" value={w[1]} onChange={(e) => setDay(d, [w[0], e.target.value || "23:59"])} />
                  </span>
                ) : <span className="muted small">{L("indisponible", "unavailable")}</span>}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The variations (option groups) and paid add-ons of a dish. */
export function OptionsEditor({ form, setForm, settlement, L }: { form: DishFormValue; setForm: Setter; settlement: string; L: (fr: string, en: string) => string }) {
  const setVar = (i: number, patch: Partial<FormVariation>) => setForm({ ...form, variations: form.variations.map((v, k) => k === i ? { ...v, ...patch } : v) });
  const setOpt = (vi: number, oi: number, patch: Partial<{ name: string; price: string }>) =>
    setVar(vi, { options: form.variations[vi]!.options.map((o, k) => k === oi ? { ...o, ...patch } : o) });
  return (
    <div className="opt-ed">
      <div className="opt-sec">
        <div className="opt-head"><h3>{L("Variations", "Variations")} <span className="muted">({L("taille, choix…", "size, choice…")})</span></h3>
          <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, variations: [...form.variations, { name: "", type: "SINGLE", required: false, options: [{ name: "", price: "" }] }] })}>+ {L("Variation", "Variation")}</button></div>
        {form.variations.map((v, vi) => (
          <div className="opt-grp" key={vi}>
            <div className="opt-grp-top">
              <input className="input" placeholder={L("Nom (ex. Taille)", "Name (e.g. Size)")} value={v.name} onChange={(e) => setVar(vi, { name: e.target.value })} />
              <select className="select" value={v.type} onChange={(e) => setVar(vi, { type: e.target.value as "SINGLE" | "MULTI" })}><option value="SINGLE">{L("Choix unique", "Single")}</option><option value="MULTI">{L("Choix multiple", "Multiple")}</option></select>
              <label className="chk"><input type="checkbox" checked={v.required} onChange={(e) => setVar(vi, { required: e.target.checked })} /> {L("Requis", "Required")}</label>
              <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, variations: form.variations.filter((_, k) => k !== vi) })}>✕</button>
            </div>
            {v.options.map((o, oi) => (
              <div className="opt-row" key={oi}>
                <input className="input" placeholder={L("Option (ex. Grande)", "Option (e.g. Large)")} value={o.name} onChange={(e) => setOpt(vi, oi, { name: e.target.value })} />
                <input className="input price" inputMode="decimal" placeholder={`+ ${settlement}`} value={o.price} onChange={(e) => setOpt(vi, oi, { price: e.target.value })} />
                <button type="button" className="btn ghost sm" onClick={() => setVar(vi, { options: v.options.filter((_, k) => k !== oi) })}>✕</button>
              </div>
            ))}
            <button type="button" className="btn ghost sm" onClick={() => setVar(vi, { options: [...v.options, { name: "", price: "" }] })}>+ {L("Option", "Option")}</button>
          </div>
        ))}
      </div>
      <div className="opt-sec">
        <div className="opt-head"><h3>{L("Add-ons", "Add-ons")} <span className="muted">({L("extras payants", "paid extras")})</span></h3>
          <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, addons: [...form.addons, { name: "", price: "" }] })}>+ {L("Add-on", "Add-on")}</button></div>
        {form.addons.map((a, ai) => (
          <div className="opt-row" key={ai}>
            <input className="input" placeholder={L("Nom (ex. Fromage)", "Name (e.g. Cheese)")} value={a.name} onChange={(e) => setForm({ ...form, addons: form.addons.map((x, k) => k === ai ? { ...x, name: e.target.value } : x) })} />
            <input className="input price" inputMode="decimal" placeholder={`+ ${settlement}`} value={a.price} onChange={(e) => setForm({ ...form, addons: form.addons.map((x, k) => k === ai ? { ...x, price: e.target.value } : x) })} />
            <button type="button" className="btn ghost sm" onClick={() => setForm({ ...form, addons: form.addons.filter((_, k) => k !== ai) })}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

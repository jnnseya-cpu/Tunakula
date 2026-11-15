/**
 * Nutri-Score 2017 algorithm (foods + beverages). Pure, no database. Hand-verified reference cases and the
 * null-on-missing-data contract (never fabricate a health label).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { beverageGrade, foodGrade, gradeFromFacts, nutriScore } from "../src/modules/nutriscore/nutriscore.ts";

test("a nutrient-poor-but-wholesome food scores A", () => {
  const r = nutriScore({ energy_kj: 300, sugars_g: 2, saturated_fat_g: 0.5, sodium_mg: 50, fibre_g: 4, protein_g: 5, fruit_veg_legume_pct: 70 });
  assert.equal(r?.negative, 0);
  assert.equal(r?.positive, 9); // fruit 2 + fibre 4 + protein 3
  assert.equal(r?.points, -9);
  assert.equal(r?.grade, "A");
});

test("a sugary, salty, fatty food scores D, with the protein rule suppressing protein", () => {
  const r = nutriScore({ energy_kj: 2000, sugars_g: 20, saturated_fat_g: 5, sodium_mg: 500, fibre_g: 2, protein_g: 8, fruit_veg_legume_pct: 0 });
  assert.equal(r?.negative, 18);      // 5 + 4 + 4 + 5
  assert.equal(r?.positive, 2);       // fruit 0 + fibre 2; protein (4) NOT counted (N≥11, fruit<5)
  assert.equal(r?.points, 16);
  assert.equal(r?.grade, "D");
});

test("salt_g and sodium_mg are interchangeable (salt = sodium × 2.5 / 1000)", () => {
  const a = nutriScore({ energy_kj: 2000, sugars_g: 20, saturated_fat_g: 5, sodium_mg: 500, fibre_g: 2, protein_g: 8, fruit_veg_legume_pct: 0 });
  const b = nutriScore({ energy_kj: 2000, sugars_g: 20, saturated_fat_g: 5, salt_g: 1.25, fibre_g: 2, protein_g: 8, fruit_veg_legume_pct: 0 });
  assert.equal(a?.points, b?.points);
});

test("plain water scores A; a sugary soda scores E (beverage scale)", () => {
  assert.equal(nutriScore({ kind: "beverage", is_water: true, energy_kj: 0, sugars_g: 0, saturated_fat_g: 0, sodium_mg: 0, fibre_g: 0, protein_g: 0, fruit_veg_legume_pct: 0 })?.grade, "A");
  const soda = nutriScore({ kind: "beverage", energy_kj: 180, sugars_g: 10.6, saturated_fat_g: 0, sodium_mg: 0, fibre_g: 0, protein_g: 0, fruit_veg_legume_pct: 0 });
  assert.equal(soda?.negative, 14); // energy 6 + sugars 8
  assert.equal(soda?.grade, "E");
});

test("returns null when any required nutrient is missing — no fabricated grade", () => {
  assert.equal(nutriScore(null), null);
  assert.equal(nutriScore({ energy_kj: 300, sugars_g: 2 /* missing sat fat, sodium, fibre, protein, fruit */ }), null);
  assert.equal(nutriScore({ energy_kj: 300, sugars_g: 2, saturated_fat_g: 0.5, sodium_mg: 50, fibre_g: 4, protein_g: 5, fruit_veg_legume_pct: -1 }), null, "negative input rejected");
});

test("gradeFromFacts maps a dish's per-100g facts to a grade, or null when incomplete", () => {
  const facts = { energy_kj_100g: 300, sugars_g_100g: 2, sat_fat_g_100g: 0.5, salt_g_100g: 0.125, fibre_g_100g: 4, protein_g_100g: 5, fruit_veg_legume_pct: 70 };
  assert.equal(gradeFromFacts(facts)?.grade, "A");
  // Per-serving-only data (no per-100g Nutri-Score inputs) yields no grade — never fabricated.
  assert.equal(gradeFromFacts({ kcal: 250, protein_g: 10, carbs_g: 30, fat_g: 8 }), null);
  assert.equal(gradeFromFacts({}), null);
  assert.equal(gradeFromFacts(undefined), null);
  // Same facts scored on the beverage scale differ from the food scale.
  const bev = { energy_kj_100g: 180, sugars_g_100g: 10.6, sat_fat_g_100g: 0, salt_g_100g: 0, fibre_g_100g: 0, protein_g_100g: 0, fruit_veg_legume_pct: 0 };
  assert.equal(gradeFromFacts(bev, { kind: "beverage" })?.grade, "E");
});

test("grade band boundaries (food and beverage)", () => {
  assert.deepEqual([-1, 0, 2, 3, 10, 11, 18, 19].map(foodGrade), ["A", "B", "B", "C", "C", "D", "D", "E"]);
  assert.deepEqual([1, 2, 5, 6, 9, 10].map((p) => beverageGrade(p, false)), ["B", "C", "C", "D", "D", "E"]);
  assert.equal(beverageGrade(99, true), "A");
});

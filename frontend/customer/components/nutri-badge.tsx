/**
 * The Nutri-Score badge (official five-colour A–E scale). Renders nothing when there is no grade. When the grade
 * came from an AI estimate (basis "ai_estimate") it carries a ~ marker and an "— estimated" label, so an estimate
 * is never shown as a measured value. Shared across the storefront so every dish card renders it identically.
 */
export type NutriGrade = "A" | "B" | "C" | "D" | "E";

export function NutriBadge({ grade, basis }: { grade?: NutriGrade | null; basis?: string | null }) {
  if (!grade) return null;
  const estimated = basis === "ai_estimate";
  return (
    <span
      className={`nutri nutri-${grade}${estimated ? " est" : ""}`}
      title={`Nutri-Score ${grade}${estimated ? " — estimated" : ""}`}
      aria-label={`Nutri-Score ${grade}${estimated ? ", estimated" : ""}`}
    >
      {grade}{estimated ? <sup aria-hidden="true">~</sup> : null}
    </span>
  );
}

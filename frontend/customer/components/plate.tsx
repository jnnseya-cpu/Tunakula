/**
 * Dish pictures: a real photo when one has been supplied (public/photos/<slug>.*), otherwise the
 * illustrated plate from plate-art.tsx. Photos are looked up at build time.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PlateArt, type Recipe } from "./plate-art";

export { PlateArt, recipeFor, type Recipe } from "./plate-art";

function photoFor(slug: string): string | undefined {
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    if (existsSync(join(process.cwd(), "public", "photos", `${slug}.${ext}`))) return `/photos/${slug}.${ext}`;
  }
  return undefined;
}

/** A real photo when one has been supplied (public/photos/<slug>.*), otherwise the illustrated plate. */
export function FoodImage({ slug, recipe, alt, className }: { slug: string; recipe: Recipe; alt: string; className?: string }) {
  const photo = photoFor(slug);
  return photo
    ? <img className={`${className ?? ""} is-photo`} src={photo} alt={alt} loading="lazy" />
    : <PlateArt className={className} recipe={recipe} seed={slug} title={alt} />;
}

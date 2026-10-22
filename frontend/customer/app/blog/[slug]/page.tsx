import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteNav } from "../../../components/site";
import { ArticleView } from "../../../components/blog";
import { ARTICLES, articleBySlug } from "../../../lib/blog";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = articleBySlug((await params).slug);
  return a ? { title: `${a.fr.title} — Tunakula`, description: a.fr.dek } : {};
}

export default async function BlogArticle({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!articleBySlug(slug)) notFound();
  return (
    <>
      <SiteNav current="/blog/" />
      <ArticleView slug={slug} />
      <SiteFooter />
    </>
  );
}

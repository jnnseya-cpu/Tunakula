import type { Metadata } from "next";
import { SiteFooter, SiteNav } from "../../components/site";
import { BlogIndex } from "../../components/blog";

export const metadata: Metadata = {
  title: "Le Playbook Tunakula — chaque fonctionnalité et son avantage",
  description:
    "Chaque fonctionnalité de Tunakula et la raison qui la fait gagner : 0 % de commission, suivi en direct, mobile money, réserver un chef, envoyer un repas, caisse sur téléphone, copilotes IA et plus.",
};

export default function BlogPage() {
  return (
    <>
      <SiteNav current="/blog/" />
      <BlogIndex />
      <SiteFooter />
    </>
  );
}

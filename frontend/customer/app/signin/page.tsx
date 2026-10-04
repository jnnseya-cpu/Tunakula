import type { Metadata } from "next";
import { SiteNav } from "../../components/site";
import { SignIn } from "../../components/account";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function SignInPage() {
  return (
    <>
      <SiteNav current="/signin/" />
      <main className="app-page narrow"><SignIn /></main>
    </>
  );
}

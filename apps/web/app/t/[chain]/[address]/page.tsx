import type { Metadata } from "next";
import { AtlasApp } from "@/components/Atlas";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { parseChain, SAFE_QUERY } from "@/lib/engine";
import type { Atlas } from "@holderatlas/core";
import pepe from "../../../../../../fixtures/PEPE--ethereum.json";

export const dynamic = "force-dynamic";
const EXAMPLE = (pepe as unknown as { atlas: Atlas }).atlas;

type Params = Promise<{ chain: string; address: string }>;

/** /t/<chain>/<address> — the permalink: the same page, streaming this token on load; OG image = the poster. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { chain, address } = await params;
  const a = safe(address);
  const c = parseChain(chain) ?? "ethereum";
  const title = `Holder Atlas — ${a.slice(0, 10)}${a.length > 10 ? "…" : ""} on ${c}`;
  return {
    title,
    description: "Where this token's holders reach exchanges from, and how much of the supply the map can honestly place.",
    openGraph: { title, images: [{ url: `/api/og?q=${encodeURIComponent(a)}&chain=${c}`, width: 1200, height: 675 }] },
    twitter: { card: "summary_large_image", title },
    alternates: { canonical: `/t/${c}/${encodeURIComponent(a)}` },
  };
}

function safe(s: string) {
  const d = (() => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  })();
  return SAFE_QUERY.test(d) ? d : "";
}

export default async function Permalink({ params }: { params: Params }) {
  const { chain, address } = await params;
  const c = parseChain(chain);
  const a = safe(address);
  return (
    <>
      <SiteHeader current="home" />
      <AtlasApp initialQuery={a || undefined} initialChain={c} example={EXAMPLE} exampleFile="fixtures/PEPE--ethereum.json" />
      <SiteFooter />
    </>
  );
}

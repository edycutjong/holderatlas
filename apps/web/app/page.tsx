import { AtlasApp } from "@/components/Atlas";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import type { Atlas } from "@holderatlas/core";
import pepe from "../../../fixtures/PEPE--ethereum.json";

export const dynamic = "force-dynamic";

/** The recorded PEPE atlas (fixtures/PEPE--ethereum.json) is the empty state's example — replayed, 0 credits, labelled. */
const EXAMPLE = (pepe as unknown as { atlas: Atlas }).atlas;

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; chain?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <SiteHeader current="home" />
      <AtlasApp initialQuery={sp.q} initialChain={sp.chain} example={EXAMPLE} exampleFile="fixtures/PEPE--ethereum.json" />
      <SiteFooter />
    </>
  );
}

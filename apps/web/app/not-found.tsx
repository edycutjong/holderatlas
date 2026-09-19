import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Holder Atlas — nothing here",
  description: "There is no map at this address. The atlas lives at /, the judge page at /judge, and every token at /t/<chain>/<address>.",
  robots: { index: false, follow: true },
};

/** app/not-found.tsx — Next renders this with HTTP 404 for any route that does not exist. Same shell, family tokens, no key. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="wrap judge">
        <p className="judge-kicker">404 · no map at this address</p>
        <h1>
          Nothing <span style={{ color: "var(--real)" }}>here</span>.
        </h1>
        <p className="judge-lede">
          This address is not one of the three places Holder Atlas has. The map is at <Link href="/">/</Link> — type a token there. The page built for judges is
          at <Link href="/judge">/judge</Link>. Every token has a permalink of the shape <code>/t/&lt;chain&gt;/&lt;address&gt;</code>, for example{" "}
          <Link href="/t/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933">/t/ethereum/0x6982…1933</Link> (PEPE). If you followed a link that landed here,
          the token or chain in it is not one the atlas knows — ethereum, base, bnb, arbitrum, optimism, avalanche, linea and solana are.
        </p>
        <p className="actions">
          <Link href="/" className="btn primary">
            Open the map
          </Link>
          <Link href="/judge" className="btn">
            For the judge
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

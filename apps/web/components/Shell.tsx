import Link from "next/link";
import pkg from "../package.json";

export const VERSION = `v${pkg.version}`;
export const REPO = "https://github.com/edycutjong/holderatlas";
export const SITE = process.env.SITE_URL || "https://holderatlas.edycu.dev";

/** The mark — a globe outline with one green bubble: one place on the map is where the holders are. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <circle cx="32" cy="32" r="26" stroke="var(--border-2)" strokeWidth="5" />
      <path d="M6 32h52M32 6c-9 8-9 44 0 52M32 6c9 8 9 44 0 52" stroke="var(--border-2)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="42" cy="24" r="10" fill="var(--real)" />
    </svg>
  );
}

export function SiteHeader({ current }: { current: "home" | "judge" }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Holder Atlas — home">
        <Mark />
        <span className="brand-name">holderatlas</span>
        <span className="brand-tag">where a token&rsquo;s holders are · on Nansen</span>
      </Link>
      <nav className="site-nav" aria-label="site">
        <Link href="/" aria-current={current === "home" ? "page" : undefined}>
          Map
        </Link>
        <Link href="/judge" aria-current={current === "judge" ? "page" : undefined}>
          For the judge
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-row">
        <span>
          <Mark size={14} /> holderatlas <a href={`${REPO}/releases/latest`}>{VERSION}</a>
        </span>
        <span className="foot-links">
          <a href={`${REPO}/blob/main/docs/SCORING.md`}>how it attributes</a>
          <a href={`${REPO}/blob/main/DEMO.md`}>reproduce it</a>
          <a href={`${REPO}/blob/main/packages/core/src/exchanges.json`}>the exchange table</a>
          <Link href="/judge">for the judge</Link>
          <a href="https://docs.nansen.ai" target="_blank" rel="noreferrer">
            Nansen API
          </a>
        </span>
      </div>
      <p className="foot-note">
        Built on the Nansen API for the Meridian Buildathon by{" "}
        <a href="https://x.com/edycutjong" target="_blank" rel="noreferrer">
          @edycutjong
        </a>
        . Countries come from exchange jurisdictions, never from people; global exchanges are never placed; the grey is the truth. Not financial advice.
      </p>
    </footer>
  );
}

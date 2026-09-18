"use client";
import { Poster, toPoster } from "./Poster";
import type { Atlas } from "@holderatlas/core";

/** The recorded PEPE atlas (fixtures/PEPE--ethereum.json) — the empty state already shows the payoff: 0 credits, labelled. */
export function Example({ atlas, onRun }: { atlas: Atlas; onRun: () => void }) {
  return (
    <section className="example" aria-labelledby="example-h">
      <div className="example-head">
        <div>
          <h2 id="example-h">
            <span className="kicker">example</span> {atlas.token.symbol} — {(atlas.attributable * 100).toFixed(0)} % of the analysed supply can be placed
          </h2>
          <p className="example-sub">
            {atlas.calls.length} Nansen calls · recorded {atlas.asOf.slice(0, 10)} · replayed from <code>fixtures/PEPE--ethereum.json</code> · 0 credits ·{" "}
            <code>{atlas.hash}</code>
          </p>
        </div>
        <button className="btn primary" onClick={onRun}>
          Run it live now
        </button>
      </div>
      <div className="picture done">
        <Poster d={toPoster(atlas)} id="example-poster" interactive />
      </div>
      <p className="example-more">
        the live run streams {atlas.examined.custody + atlas.examined.human} wallets one by one — each gains its exchange, the map fills, the number counts
      </p>
    </section>
  );
}

export function HowItDecides() {
  return (
    <section className="how" aria-labelledby="how-h">
      <h2 id="how-h">How it decides — five Nansen calls, one curated table, no guessing</h2>
      <ol className="how-grid">
        <li className="how-step">
          <span className="how-n">1</span>
          <code className="how-ep">
            search/
            <wbr />
            general
          </code>
          <span className="how-cr">0 cr</span>
          <p>ticker → the token and its chain</p>
          <p className="how-decides">→ which contract to map</p>
        </li>
        <li className="how-step">
          <span className="how-n">2</span>
          <code className="how-ep">
            tgm/
            <wbr />
            holders ×2
          </code>
          <span className="how-cr">5 + 5 cr</span>
          <p>top 100 holders, and which of them are exchange custody</p>
          <p className="how-decides">→ custody · people · pools (excluded)</p>
        </li>
        <li className="how-step">
          <span className="how-n">3</span>
          <code className="how-ep">
            tgm/
            <wbr />
            transfers
          </code>
          <span className="how-cr">1 cr / wallet</span>
          <p>the wallet&rsquo;s newest exchange-touching transfer of this token</p>
          <p className="how-decides">→ a transaction hash, or &ldquo;no trace&rdquo;</p>
        </li>
        <li className="how-step">
          <span className="how-n">4</span>
          <code className="how-ep">
            transaction-
            <wbr />
            with-
            <wbr />
            token-
            <wbr />
            transfer-
            <wbr />
            lookup
          </code>
          <span className="how-cr">1 cr / wallet</span>
          <p>the exchange entity on that transfer: &ldquo;🏦 Upbit&rdquo;, &ldquo;🏦 Coinbase&rdquo;</p>
          <p className="how-decides">→ exchanges.json → country, or global</p>
        </li>
      </ol>
      <ul className="proof-row">
        <li>
          <b>118</b> credits per cold atlas · <b>0</b> warm
        </li>
        <li>
          <b>40 s</b> cold p50 · <b>7 ms</b> warm
        </li>
        <li>
          <b>12/12</b> atlases replay offline
        </li>
        <li>
          <b>133</b> exchanges in the table, one source each
        </li>
      </ul>
    </section>
  );
}

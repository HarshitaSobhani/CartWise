# Source adapters

A *source* is a row in `Source`; a *source adapter* is code (registered in `server/src/adapters/registry.ts`) that can fetch observations for the products belonging to that source.

```ts
interface SourceAdapter {
  slug: string;            // must equal Source.slug
  name: string;
  kind: 'DEMO' | 'CSV' | 'API';
  isDemo: boolean;
  origin: 'DEMO' | 'CSV_IMPORT' | 'EXTERNAL';   // stored on every observation
  fetchObservations(ctx: { products: {id, externalRef}[]; now: Date }): Promise<AdapterObservation[]>;
}
// AdapterObservation: { externalRef, price: '19.99', currency: 'USD', observedAt: Date, sourceRef?, sourceUrl? }
```

Rules for adapters:
1. Use only an official API or documented integration you are licensed for. **Do not scrape, bypass CAPTCHAs, rate limits or access controls.**
2. Return only prices actually returned by the source, with the source’s own timestamp as `observedAt`. Throw on failure — never return guessed/cached-as-new values.
3. Read credentials from environment variables; never log them (errors are additionally scrubbed by `safeErrorMessage`).
4. Be deterministic per `(product, observedAt)` so re-runs deduplicate (key = product+source+price+currency+observedAt).

Built-in sources
| Slug | Kind | Origin | Notes |
|---|---|---|---|
| `demo` | DEMO | `DEMO` | Deterministic **synthetic** prices (one per UTC day, USD). Used by the seed and the scheduled refresh so the app is usable offline. Always labelled “Demo data”. |
| `csv-import` | CSV | `CSV_IMPORT` | Created on first import. Has no adapter; updated only by CSV import. Shown as “Recorded” (supplied by an admin, not verified by CartWise). |

Adding an adapter: create `server/src/adapters/<name>.ts`, `registerAdapter(...)` it in `registry.ts`, create the `Source` row (`slug` matching, `kind: 'API'`), create products with `sourceId` and `externalRef` = the source’s product id, then run **Admin → Sources → Refresh now**. The scheduler picks up every enabled source that has an adapter.

No retailer adapters are shipped: none has a supported API credential configured in this project.

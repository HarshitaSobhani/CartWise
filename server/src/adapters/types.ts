import type { ObservationOrigin, SourceKind } from '@prisma/client';

export interface AdapterProduct {
  id: string;
  externalRef: string;
}

export interface AdapterObservation {
  externalRef: string;
  price: string; // decimal string, 2dp
  currency: string;
  observedAt: Date;
  sourceRef?: string;
  sourceUrl?: string;
}

export interface FetchContext {
  products: AdapterProduct[];
  now: Date;
}

/**
 * A SourceAdapter fetches observations for products that belong to its source.
 * Adapters must only use supported APIs / documented integrations, must never
 * invent prices, and must throw on failure (the job runner handles retries).
 */
export interface SourceAdapter {
  slug: string;
  name: string;
  kind: SourceKind;
  isDemo: boolean;
  origin: ObservationOrigin;
  fetchObservations(ctx: FetchContext): Promise<AdapterObservation[]>;
}

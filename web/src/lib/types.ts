export interface User { id: string; email: string; name: string; role: 'USER' | 'ADMIN'; emailNotifs: boolean; inAppNotifs: boolean }
export interface Freshness { status: 'none' | 'fresh' | 'stale'; ageHours: number | null; lastObservedAt: string | null }
export interface ProductCardData {
  id: string; name: string; brand: string | null; category: string; imageUrl: string | null;
  source: { id: string; name: string; isDemo: boolean };
  latest: { price: string; currency: string; observedAt: string; isDemo: boolean; sourceName: string } | null;
  otherCurrencies: string[]; freshness: Freshness;
}
export interface Obs { id: string; sourceId: string; price: string; currency: string; observedAt: string; origin: string; sourceUrl: string | null }
export interface Change { percent: string | null; from: string; to: string; fromAt: string; toAt: string }
export interface Stats {
  count: number; currencies: string[]; currencyMismatch: boolean; latest: Obs | null; changeVsPrevious: Change | null; changeOverWindow: Change | null;
  lowestRecorded: Obs | null; highestRecorded: Obs | null; freshness: Freshness;
}
export interface Point extends Obs { sourceName: string; isDemo: boolean }
export interface TargetState { status: 'no-data' | 'currency-mismatch' | 'above-target' | 'met'; latestPrice: string | null; gap: string | null }
export interface AlertData {
  id: string; targetPrice: string; currency: string; status: 'ACTIVE' | 'TRIGGERED' | 'PAUSED'; notifyInApp: boolean; notifyEmail: boolean; target: TargetState;
  product?: { id: string; name: string };
}
export interface Coverage { sourceId: string; sourceName: string; isDemo: boolean; origin: string; currency: string; observationCount: number; latest: Obs; freshness: Freshness }
export interface CompareRow {
  product: { id: string; name: string; brand: string | null; category: string; specs: Record<string, string> | null; sourceName: string };
  currencies: string[]; latest: (Obs & { sourceName: string; isDemo: boolean }) | null; changeVsPrevious: { percent: string | null; from: string } | null;
  freshness: Freshness; sourceCount: number; observationCount: number; lowestRecorded: string | null; missingReason: string | null;
  differenceFromCheapest: { amount: string; percent: string | null } | null;
}
export interface CompareResult { currency: string | null; availableCurrencies: string[]; currencyMismatch: boolean; warning: string | null; notComparable: string[]; cheapestProductId: string | null; rows: CompareRow[] }

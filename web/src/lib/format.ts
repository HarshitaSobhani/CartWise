export function formatMoney(price: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(price));
  } catch {
    return `${currency} ${price}`;
  }
}
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString();
export function formatAge(hours: number | null): string {
  if (hours === null) return 'no data';
  if (hours < 1) return 'less than 1 hour ago';
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}
export const signedPercent = (p: string | null) => (p === null ? 'n/a' : `${Number(p) > 0 ? '+' : ''}${p}%`);

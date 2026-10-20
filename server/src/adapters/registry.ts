import type { SourceAdapter } from './types.js';
import { demoAdapter } from './demo.js';

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(a: SourceAdapter): void {
  adapters.set(a.slug, a);
}
export function getAdapter(slug: string): SourceAdapter | undefined {
  return adapters.get(slug);
}
export function listAdapters(): SourceAdapter[] {
  return [...adapters.values()];
}
export function unregisterAdapter(slug: string): void {
  adapters.delete(slug);
}

registerAdapter(demoAdapter);

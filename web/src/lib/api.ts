export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  return data as T;
}

export const errorMessage = (e: unknown): string => {
  if (e instanceof ApiError) {
    const d = e.details?.length ? `: ${e.details.map((x) => (x.path ? `${x.path} ${x.message}` : x.message)).join('; ')}` : '';
    return `${e.message}${d}`;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
};

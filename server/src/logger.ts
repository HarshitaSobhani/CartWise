import pino from 'pino';

// Redact anything that could carry credentials.
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: ['password', '*.password', 'passwordHash', '*.passwordHash', 'token', 'authorization', 'req.headers.authorization', 'req.headers.cookie', 'SMTP_PASS', 'JWT_SECRET'],
    censor: '[redacted]',
  },
});

/** Reduce an error to a short message that is safe to store and show to admins. */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(postgres(ql)?|redis|https?):\/\/[^\s]+/gi, '$1://[redacted]')
    .replace(/(password|secret|token|apikey|api_key|authorization)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 500);
}

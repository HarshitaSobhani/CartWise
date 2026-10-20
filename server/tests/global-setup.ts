import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://cartwise:cartwise@localhost:5432/cartwise_test';
  if (!/test/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must point to a database with "test" in its name');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}

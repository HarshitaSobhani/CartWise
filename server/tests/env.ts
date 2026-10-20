// Loaded before any app module: point everything at the dedicated test database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://cartwise:cartwise@localhost:5432/cartwise_test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.ADMIN_EMAILS = 'boss@example.com';
delete process.env.REDIS_URL;
if (!/test/i.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw new Error('Refusing to run tests against a database whose name does not contain "test"');
}

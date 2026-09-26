export const testEnv = {
  DATABASE_URL: 'postgresql://lifeos:lifeos@localhost:55439/lifeos_test',
  AUTH_URL: 'http://localhost:3100',
  AUTH_SECRET: 'test-only-secret-not-for-real-deployments-12345',
  AUTH_GOOGLE_ID: 'lifeos-test-client',
  AUTH_GOOGLE_SECRET: 'test-client-secret',
  ALLOWED_GOOGLE_SUB: 'allowed-subject',
  ALLOWED_EMAIL: 'owner@example.test',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  DEMO_MODE: 'false',
};

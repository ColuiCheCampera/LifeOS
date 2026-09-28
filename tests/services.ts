// Test-only OIDC issuer + Auth.js harness. Never imported by application code.
import { testEnv } from './env';
Object.assign(process.env, testEnv);
import EmbeddedPostgres from 'embedded-postgres';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Auth } from '@auth/core';
import Google from '@auth/core/providers/google';
async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: `./work/test-postgres-${randomUUID()}`,
    user: 'lifeos',
    password: 'lifeos',
    port: 55439,
    persistent: false,
    // Windows force-stops test process trees; avoid orphaned PostgreSQL 18 I/O workers.
    postgresFlags: process.platform === 'win32' ? ['-c', 'io_method=sync'] : [],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('lifeos_test');
  const pool = new Pool({ connectionString: testEnv.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  const { authConfig } = await import('../src/server/auth/config');
  const { pool: appPool } = await import('../src/server/db');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'test-key', alg: 'RS256', use: 'sig' });
  const issuer = 'http://localhost:4011';
  const codes = new Map<
    string,
    { nonce: string; challenge: string; mode: string; redirect: string }
  >();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', issuer);
      const send = (value: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === '/ready') return send({ ok: true });
      if (url.pathname === '/.well-known/openid-configuration')
        return send({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          userinfo_endpoint: issuer + '/userinfo',
          jwks_uri: issuer + '/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          code_challenge_methods_supported: ['S256'],
        });
      if (url.pathname === '/jwks') return send({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const code = randomUUID();
        codes.set(code, {
          nonce: url.searchParams.get('nonce') ?? '',
          challenge: url.searchParams.get('code_challenge') ?? '',
          mode: url.searchParams.get('test_profile') ?? 'allowed',
          redirect: url.searchParams.get('redirect_uri') ?? '',
        });
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { Location: callback.href });
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      if (url.pathname === '/token') {
        const params = new URLSearchParams(body);
        const record = codes.get(params.get('code') ?? '');
        if (!record) return send({ error: 'invalid_grant' }, 400);
        codes.delete(params.get('code')!);
        if (
          createHash('sha256')
            .update(params.get('code_verifier') ?? '')
            .digest('base64url') !== record.challenge ||
          params.get('redirect_uri') !== record.redirect
        )
          return send({ error: 'invalid_grant' }, 400);
        const token = await new SignJWT({
          sub: record.mode === 'wrong-sub' ? 'attacker' : testEnv.ALLOWED_GOOGLE_SUB,
          email: record.mode === 'wrong-email' ? 'attacker@example.test' : testEnv.ALLOWED_EMAIL,
          email_verified: record.mode !== 'unverified',
          name: 'Lorenzo Demo',
          nonce: record.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer(issuer)
          .setAudience(testEnv.AUTH_GOOGLE_ID)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return send({
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 300,
          id_token: token,
        });
      }
      if (url.pathname.startsWith('/api/auth/')) {
        const config = authConfig(req.headers['user-agent'], req.headers.cookie);
        config.basePath = '/api/auth';
        config.providers = [
          Google({
            clientId: testEnv.AUTH_GOOGLE_ID,
            clientSecret: testEnv.AUTH_GOOGLE_SECRET,
            issuer,
            wellKnown: issuer + '/.well-known/openid-configuration',
            authorization: { params: { scope: 'openid email profile' } },
            checks: ['pkce', 'state', 'nonce'],
          }),
        ];
        config.logger = {
          error: (error) => {
            if (!('type' in error && error.type === 'AccessDenied')) console.error(error);
          },
          warn: () => {},
          debug: () => {},
        };
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const response = await Auth(
          new Request(url, {
            method: req.method,
            headers,
            ...(req.method === 'POST' ? { body } : {}),
          }),
          config,
        );
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie') res.setHeader(key, value);
        });
        res.setHeader('set-cookie', response.headers.getSetCookie());
        res.end(await response.text());
        return;
      }
      return send({ error: 'not found' }, 404);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.end('Test service failed');
    }
  });
  server.listen(4011, '127.0.0.1', () => console.log('Test services ready'));
  const stop = async () => {
    server.close();
    await pool.end();
    await appPool.end();
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

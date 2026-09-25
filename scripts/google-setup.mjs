import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
process.umask(0o077);
delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
const client = JSON.parse(readFileSync('google-client.json', 'utf8')).web;
const redirect = 'http://localhost:3000/api/auth/callback/google';
if (!client?.client_id || !client?.client_secret || !client.redirect_uris?.includes(redirect)) {
  throw new Error(
    'Il JSON deve essere un client Web con il redirect http://localhost:3000/api/auth/callback/google',
  );
}
function save(values) {
  let env = readFileSync('.env.local', 'utf8');
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string' || /[\r\n"\\]/.test(value))
      throw new Error('Valore di configurazione non valido');
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, () => line) : env + '\n' + line + '\n';
  }
  writeFileSync('.env.local', env, { mode: 0o600 });
  chmodSync('.env.local', 0o600);
}
chmodSync('google-client.json', 0o600);
save({ AUTH_GOOGLE_ID: client.client_id, AUTH_GOOGLE_SECRET: client.client_secret });
if (process.argv.includes('--check')) {
  console.log('Client Web importato; redirect verificato. Nessun segreto mostrato.');
  process.exit(0);
}
const state = randomBytes(32).toString('base64url');
const nonce = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const entry = randomBytes(24).toString('base64url');
const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorization.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirect,
  response_type: 'code',
  scope: 'openid email profile',
  state,
  nonce,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  code_challenge_method: 'S256',
  prompt: 'select_account',
}).toString();
const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
let used = false;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (req.headers.host !== 'localhost:3000' || req.method !== 'GET') {
    res.writeHead(403);
    res.end('Richiesta non consentita');
    return;
  }
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname === `/configure-google/${entry}`) {
    res.writeHead(302, { Location: authorization.href });
    res.end();
    return;
  }
  if (url.pathname !== '/api/auth/callback/google') {
    res.writeHead(404);
    res.end('Apri il link di configurazione fornito.');
    return;
  }
  if (used || url.searchParams.get('state') !== state) {
    res.writeHead(403);
    res.end('Verifica scaduta o non valida. Riavvia la configurazione.');
    return;
  }
  used = true;
  try {
    const googleError = url.searchParams.get('error');
    if (googleError) {
      const known = ['access_denied', 'invalid_request', 'invalid_client', 'redirect_uri_mismatch'];
      const error = new Error('Google ha rifiutato il consenso');
      error.code = known.includes(googleError) ? googleError : 'oauth_consent_failed';
      throw error;
    }
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Consenso non completato');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const error = new Error('Scambio OAuth rifiutato');
      error.code = ['invalid_client', 'invalid_grant', 'unauthorized_client'].includes(result.error)
        ? result.error
        : 'oauth_exchange_failed';
      throw error;
    }
    const tokens = await response.json();
    const { payload } = await jwtVerify(tokens.id_token, keys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: client.client_id,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'email', 'email_verified', 'nonce', 'exp', 'iat'],
    });
    if (
      payload.nonce !== nonce ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string' ||
      typeof payload.sub !== 'string'
    )
      throw new Error('Identità non verificata');
    save({ ALLOWED_GOOGLE_SUB: payload.sub, ALLOWED_EMAIL: payload.email });
    res.end(
      'Account Google verificato e configurato. Puoi chiudere questa scheda e tornare alla conversazione.',
    );
    console.log(
      'GOOGLE_SETUP_COMPLETE: identità verificata e allowlist salvata. Token non conservati.',
    );
  } catch (error) {
    const code = String(error.code ?? error.cause?.code ?? error.name)
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 80);
    res.writeHead(400);
    res.end('Configurazione non completata. Codice: ' + code + '. Torna alla conversazione.');
    console.log('GOOGLE_SETUP_FAILED:', code, 'Nessuna modifica alla allowlist.');
  } finally {
    clearTimeout(timer);
    server.close();
  }
});
const timer = setTimeout(() => {
  console.log('Verifica scaduta: riavvia npm run setup:google');
  server.close();
}, 10 * 60000);
server.on('error', (error) => {
  clearTimeout(timer);
  console.error('Impossibile avviare la verifica locale:', error.code);
  process.exitCode = 1;
});
server.listen(3000, '127.0.0.1', () =>
  console.log(`Apri http://localhost:3000/configure-google/${entry}`),
);

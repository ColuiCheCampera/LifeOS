import 'server-only';
import pino from 'pino';
export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: [
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'password',
    'secret',
    'req.headers.authorization',
    'req.headers.cookie',
  ],
});

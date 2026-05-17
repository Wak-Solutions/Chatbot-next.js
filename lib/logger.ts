/**
 * Pino-based structured logger shared by the Next.js app and the worker.
 *
 * - createLogger(module) returns a Pino child bound to { module }.
 * - child(parent, module) re-scopes an existing logger.
 * - Redact paths cover the common secret/credential shapes we send through
 *   logger calls (tokens, passwords, session secrets, Authorization /
 *   Cookie headers). Customer-phone redaction is a defense-in-depth measure;
 *   call sites should still maskPhone() before logging.
 */

import pino from 'pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';

const redactPaths = [
  // Generic credential fields (top-level or nested under any single key).
  'password',
  '*.password',
  'token',
  '*.token',
  'access_token',
  '*.access_token',
  'authorization',
  '*.authorization',

  // App / tenant secrets.
  'session_secret',
  '*.session_secret',
  'SESSION_SECRET',
  'webhook_secret',
  '*.webhook_secret',
  'whatsapp_token',
  '*.whatsapp_token',
  'whatsapp_app_secret',
  '*.whatsapp_app_secret',

  // Common HTTP headers that carry secrets.
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',

  // Customer PII — call sites still maskPhone() at the boundary, but if a
  // raw inbound payload slips through verbatim, prefer redacted over leaked.
  'customer_phone',
  '*.customer_phone',
];

function baseOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL ?? 'info';
  const isDev = process.env.NODE_ENV !== 'production';
  const opts: LoggerOptions = {
    level,
    redact: {
      paths: redactPaths,
      remove: false,
      censor: '[REDACTED]',
    },
    base: { service: process.env.SERVICE_NAME ?? 'app' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  if (isDev) {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
    };
  }
  return opts;
}

let rootLogger: PinoLogger | null = null;

function getRoot(): PinoLogger {
  if (!rootLogger) {
    rootLogger = pino(baseOptions());
  }
  return rootLogger;
}

export type Logger = PinoLogger;

export function createLogger(module: string): Logger {
  return getRoot().child({ module });
}

export function child(parent: Logger, module: string): Logger {
  return parent.child({ module });
}

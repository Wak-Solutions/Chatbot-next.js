/**
 * Shared HTTP error classes + JSON envelope for Route Handlers.
 *
 * HttpError carries a status, a stable string `code`, a user-visible
 * message, and optional `details`. Routes throw it; the wrapper helpers
 * in @/lib/http/handlers catch it and produce a NextResponse with a
 * consistent JSON shape.
 *
 * Envelope:
 *   { message: string; code: string; details?: object }
 *
 * The legacy server responded with plain `{ message }` — the new `code`
 * field is additive and ignored by older clients.
 */

import { NextResponse } from 'next/server';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', details?: Record<string, unknown>) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class TrialExpiredError extends HttpError {
  constructor(details: { trialDays: number; expiresAt: string | null }) {
    super(
      402,
      'TRIAL_EXPIRED',
      'Your free trial has expired. Please contact support to continue.',
      { trialExpired: true, ...details },
    );
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class CsrfError extends HttpError {
  constructor(message = 'Invalid CSRF token') {
    super(403, 'CSRF_INVALID', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super(409, 'CONFLICT', message, details);
  }
}

export class RateLimitedError extends HttpError {
  constructor(message = 'Too many requests', details?: Record<string, unknown>) {
    super(429, 'RATE_LIMITED', message, details);
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

export interface HttpErrorEnvelope {
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

export function toErrorEnvelope(err: HttpError): HttpErrorEnvelope {
  const env: HttpErrorEnvelope = { message: err.message, code: err.code };
  if (err.details) env.details = err.details;
  return env;
}

export function toJsonResponse(err: HttpError): NextResponse {
  return NextResponse.json(toErrorEnvelope(err), { status: err.status });
}

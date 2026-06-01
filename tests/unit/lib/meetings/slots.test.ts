/**
 * lib/meetings/slots — work-hours enforcement logic.
 *
 * These pure helpers are what the booking path delegates to:
 *   - isWithinWorkHours gates the POST accept in app/api/book/[token]
 *     (out-of-hours → 400) and now also drives the dashboard grid's
 *     "closed" rendering.
 *   - getSlotsForDay builds the bookable slot list shown to the customer.
 *
 * The invariant: a slot is bookable ONLY if its day is a work day AND its
 * hour falls in [start, end). End is exclusive; '00:00' is treated as 24
 * (midnight as the end-of-day boundary). Evaluated in KSA-local time — the
 * single-region assumption documented in slots.ts (work_hours.timezone is
 * not yet honored).
 *
 * Pure functions, no DB — runs as a unit test (does not touch the prod
 * Postgres the integration suite uses). The route-level conflict check
 * against the calendar_events VIEW still needs a dedicated test DB to
 * cover safely and is intentionally out of scope here.
 */
import { describe, expect, it } from 'vitest';
import { getSlotsForDay, isWithinWorkHours } from '@/lib/meetings/slots';
import type { WorkHours } from '@/lib/companies/workHours';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Derive the weekday of a fixed date the same way the helper does, so the
// assertions hold regardless of which calendar weekday it lands on.
const DATE = '2026-06-01';
const DAY_NAME = DAY_NAMES[new Date(`${DATE}T00:00:00Z`).getUTCDay()];
const OTHER_DAYS = DAY_NAMES.filter((d) => d !== DAY_NAME);

const wh = (over: Partial<WorkHours> = {}): WorkHours => ({
  days: [DAY_NAME],
  start: '09:00',
  end: '18:00',
  timezone: 'Asia/Riyadh',
  ...over,
});

describe('isWithinWorkHours', () => {
  it('accepts a slot inside the window on a work day', () => {
    expect(isWithinWorkHours(DATE, '10:00', wh())).toBe(true);
    expect(isWithinWorkHours(DATE, '09:00', wh())).toBe(true); // start is inclusive
  });

  it('rejects a slot before the start hour', () => {
    expect(isWithinWorkHours(DATE, '08:00', wh())).toBe(false);
  });

  it('rejects a slot at/after the end hour (end is exclusive)', () => {
    expect(isWithinWorkHours(DATE, '18:00', wh())).toBe(false);
    expect(isWithinWorkHours(DATE, '19:00', wh())).toBe(false);
  });

  it('rejects every slot on a non-work day', () => {
    expect(isWithinWorkHours(DATE, '10:00', wh({ days: OTHER_DAYS }))).toBe(false);
  });

  it("treats '00:00' end as midnight (24): 23:00 in, 00:00 out", () => {
    const midnight = wh({ start: '17:00', end: '00:00' });
    expect(isWithinWorkHours(DATE, '23:00', midnight)).toBe(true);
    expect(isWithinWorkHours(DATE, '00:00', midnight)).toBe(false);
  });
});

describe('getSlotsForDay', () => {
  it('returns the [start, end) hours for a work day', () => {
    const monday = DAY_NAMES.indexOf('Mon');
    expect(
      getSlotsForDay(monday, { days: ['Mon'], start: '09:00', end: '12:00', timezone: 'Asia/Riyadh' }),
    ).toEqual(['09:00', '10:00', '11:00']);
  });

  it('returns no slots for a non-work day', () => {
    const tuesday = DAY_NAMES.indexOf('Tue');
    expect(
      getSlotsForDay(tuesday, { days: ['Mon'], start: '09:00', end: '12:00', timezone: 'Asia/Riyadh' }),
    ).toEqual([]);
  });

  it('falls back to the legacy schedule when no work hours are supplied', () => {
    // Non-Friday: 07:00..23:00 then 00:00 (18 slots).
    const wed = DAY_NAMES.indexOf('Wed');
    const slots = getSlotsForDay(wed);
    expect(slots[0]).toBe('07:00');
    expect(slots[slots.length - 1]).toBe('00:00');
    expect(slots).toHaveLength(18);
    // Friday is the short day (starts at 17:00).
    const fri = DAY_NAMES.indexOf('Fri');
    expect(getSlotsForDay(fri)[0]).toBe('17:00');
  });
});

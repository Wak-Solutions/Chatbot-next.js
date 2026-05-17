/**
 * Booking slot utilities — port of server/lib/slots.ts.
 *
 * getSlotsForDay returns bookable hour slots for a given day of week,
 * honoring the company's WorkHours config; falls back to a "07:00-00:00,
 * Friday short" legacy schedule if work hours aren't supplied.
 *
 * isWithinWorkHours validates a KSA-local (date, time) pair against the
 * given WorkHours. Both helpers treat "00:00" as 24:00 (midnight as the
 * end-of-day boundary) so callers can express "open through midnight"
 * without crossing date lines in slot generation.
 */

import type { WorkHours } from '@/lib/companies/workHours';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseHourStr(t: string): number {
  if (t === '00:00') return 24;
  return parseInt(t.split(':')[0], 10);
}

export function getSlotsForDay(ksaDayOfWeek: number, workHours?: WorkHours): string[] {
  const dayName = DAY_NAMES[ksaDayOfWeek];

  if (workHours) {
    if (!workHours.days.includes(dayName)) return [];
    const startH = parseHourStr(workHours.start);
    const endH = parseHourStr(workHours.end);
    const slots: string[] = [];
    for (let h = startH; h < endH; h++) {
      slots.push(h === 24 ? '00:00' : `${String(h).padStart(2, '0')}:00`);
    }
    return slots;
  }

  // Legacy fallback: pre-work-hours behavior (Friday short, others 07:00-00:00).
  const start = ksaDayOfWeek === 5 ? 17 : 7;
  const slots: string[] = [];
  for (let h = start; h <= 23; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  slots.push('00:00');
  return slots;
}

export function isWithinWorkHours(ksaDate: string, ksaTime: string, wh: WorkHours): boolean {
  const d = new Date(ksaDate + 'T00:00:00Z');
  const dayName = DAY_NAMES[d.getUTCDay()];
  if (!wh.days.includes(dayName)) return false;

  const slotH = ksaTime === '00:00' ? 24 : parseInt(ksaTime.split(':')[0], 10);
  const startH = parseHourStr(wh.start);
  const endH = parseHourStr(wh.end);

  return slotH >= startH && slotH < endH;
}

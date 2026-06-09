/**
 * Format a Date to YYYY-MM-DD in Asia/Taipei timezone.
 */
export function fmtDate(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

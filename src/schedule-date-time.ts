/** Bridge the editor's local/ISO draft to the calendar's explicit UTC instant.
 * Empty/invalid drafts stay empty; do not turn them into a default scheduled run.
 */
export function schedulePickerValue(value: string): string {
  if (!value.trim()) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

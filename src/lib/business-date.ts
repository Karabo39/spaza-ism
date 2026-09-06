/** Calendar dates used by reports are South African dates, including midnight. */
export function businessDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function calendarDay(day: string): Date {
  const date = new Date(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error("Use a valid report date in YYYY-MM-DD format.");
  return date;
}
export function businessDayStart(day: string): string {
  calendarDay(day);
  return `${day}T00:00:00+02:00`;
}
export function businessDayAfter(day: string): string {
  const date = calendarDay(day);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)}T00:00:00+02:00`;
}

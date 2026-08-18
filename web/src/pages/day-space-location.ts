const BUSINESS_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatLocalBusinessDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function businessDateToLocalDate(value: string): Date | null {
  const match = BUSINESS_DATE_RE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function isBusinessDate(value: string): boolean {
  return businessDateToLocalDate(value) !== null;
}

export function parseExplicitDaySpaceDate(search: string): string | null {
  const value = new URLSearchParams(search).get("date");
  return value && isBusinessDate(value) ? value : null;
}

export function shiftBusinessDate(value: string, amount: number): string {
  const date = businessDateToLocalDate(value);
  if (!date) throw new Error(`Invalid business date: ${value}`);
  date.setDate(date.getDate() + amount);
  return formatLocalBusinessDate(date);
}

export function resolveLatestBusinessDate(
  contentDates: readonly string[],
  today: string,
): string {
  const valid = [...new Set(contentDates.filter(isBusinessDate))].sort();
  return valid.at(-1) ?? today;
}

export function buildDaySpaceLocation(value: string): string {
  if (!isBusinessDate(value)) throw new Error(`Invalid business date: ${value}`);
  return `/day-space?date=${encodeURIComponent(value)}`;
}

export function formatDaySpaceDateLabel(value: string): string {
  return value.replaceAll("-", ".");
}

export function formatDaySpaceNavigationDate(value: string): string {
  const date = businessDateToLocalDate(value);
  if (!date) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

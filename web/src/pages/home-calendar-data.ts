const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function mergeCalendarContentDates(
  todoDates: readonly string[],
  diaryDates: readonly string[],
): string[] {
  return [...new Set([...todoDates, ...diaryDates].filter((date) => BUSINESS_DATE_PATTERN.test(date)))].sort();
}

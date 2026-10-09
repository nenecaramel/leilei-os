import type { UniverseDiarySourceSummary, UniverseDiarySourceOption } from "./universe-types";

export function formatDiarySourceDate(value: string): string {
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value;
}

export function sourceOptionFromSummary(source: UniverseDiarySourceSummary): UniverseDiarySourceOption {
  return { id: source.diaryId, title: source.title, date: source.date, status: source.status };
}

export function formatUniverseNodeTimestamp(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

export function formatStandaloneDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

export function formatMembershipWeight(weight: number): string {
  if (weight >= 0 && weight <= 1) return `${Math.round(weight * 100)}%`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(weight);
}

export function canonicalWeightTextToPercentText(weightText: string): string {
  if (!weightText.trim()) return "";
  const percent = Number(weightText) * 100;
  if (!Number.isFinite(percent)) return "";
  return String(Number(percent.toFixed(3)));
}

export function percentWeightTextToCanonicalText(percentText: string): string {
  if (!percentText.trim()) return "";
  const canonical = Number(percentText) / 100;
  if (!Number.isFinite(canonical)) return "";
  return String(Number(canonical.toFixed(6)));
}

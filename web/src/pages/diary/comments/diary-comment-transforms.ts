import type { DiaryComment } from "./diary-comment-types";

export function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return [
    `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

export function mergeComments(
  existing: readonly DiaryComment[],
  incoming: readonly DiaryComment[],
): DiaryComment[] {
  const byId = new Map(existing.map((comment) => [comment.id, comment]));
  for (const comment of incoming) byId.set(comment.id, comment);
  return [...byId.values()].sort((left, right) => {
    const byTime = left.created_at.localeCompare(right.created_at);
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  });
}

export function replaceComment(
  comments: readonly DiaryComment[],
  next: DiaryComment,
): DiaryComment[] {
  return comments.map((comment) => comment.id === next.id ? next : comment);
}

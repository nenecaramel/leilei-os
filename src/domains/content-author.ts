export const CONTENT_AUTHORS = ["L", "G", "C"] as const;

export type ContentAuthor = (typeof CONTENT_AUTHORS)[number];

export function isContentAuthor(value: unknown): value is ContentAuthor {
  return value === "L" || value === "G" || value === "C";
}

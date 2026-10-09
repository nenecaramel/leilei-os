import type { PaperAuthorValue } from "../PaperAuthorSignature";
import type { DiaryComment, DiaryCommentsMetadata } from "../DiaryComments";

export type DiaryEntry = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  created_at: string;
  updated_at: string;
  author: PaperAuthorValue;
  comments?: DiaryComment[];
  comments_metadata?: DiaryCommentsMetadata;
};

export type LoadState =
  | { status: "loading" }
  | { status: "ready"; diaries: DiaryEntry[]; count: number }
  | { status: "error" };
export type DetailState = "idle" | "loading" | "ready" | "error";

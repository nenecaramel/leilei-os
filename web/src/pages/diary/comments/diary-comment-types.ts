import type { PaperAuthor } from "../../PaperAuthorSignature";

export type DiaryComment = {
  id: string;
  diary_id: string;
  author: PaperAuthor;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type DiaryCommentsMetadata = {
  count: number;
  returned: number;
  truncated: boolean;
};

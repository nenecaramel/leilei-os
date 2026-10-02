import type {
  NativeLiveAttachmentDownloadSlot,
} from "../bridge/native-live-attachment-storage.js";

export type ClaudeAlbumPhoto = {
  id: string;
  userId: string;
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  description: string | null;
  whySaved: string;
  tags: string[];
  sourceAttachmentId: string;
  sourceMessageId: string | null;
  triggerUserMessageId: string;
  createdAt: string;
};

export type ClaudeAlbumMessageSaveProjection = {
  userMessageId: string;
  total: number;
};

export type ClaudeAlbumSearchInput = {
  userId: string;
  query: string | null;
  limit: number;
};

export interface ClaudeAlbumPhotoRepository {
  findBySourceAttachment(input: {
    userId: string;
    sourceAttachmentId: string;
  }): Promise<ClaudeAlbumPhoto | null>;

  create(input: {
    photo: ClaudeAlbumPhoto;
  }): Promise<
    | { outcome: "created"; photo: ClaudeAlbumPhoto }
    | { outcome: "source_exists"; photo: ClaudeAlbumPhoto }
  >;

  get(input: {
    userId: string;
    photoId: string;
  }): Promise<ClaudeAlbumPhoto | null>;

  search(input: ClaudeAlbumSearchInput): Promise<ClaudeAlbumPhoto[]>;

  countByTriggerUserMessage(input: {
    userId: string;
    userMessageId: string;
  }): Promise<number>;
}

export type PromotedClaudeAlbumPhoto = {
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceAttachmentId: string;
  sourceMessageId: string | null;
};

export interface ClaudeAlbumPhotoPromoter {
  promote(input: {
    userId: string;
    photoId: string;
    sourceAttachmentId: string;
    triggerUserMessageId: string;
  }): Promise<PromotedClaudeAlbumPhoto>;

  deletePromoted(input: {
    objectKey: string;
  }): Promise<void>;

  createDownloadSlot(input: {
    objectKey: string;
  }): NativeLiveAttachmentDownloadSlot;
}

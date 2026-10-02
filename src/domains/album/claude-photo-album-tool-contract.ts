import type {
  ClaudeAlbumPhoto,
} from "./claude-photo-album-types.js";

export type ClaudeAlbumToolPhoto = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  description: string | null;
  whySaved: string;
  tags: string[];
  sourceAttachmentId: string;
  sourceMessageId: string | null;
  createdAt: string;
};

export type ClaudeAlbumToolImage = {
  data: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export type ClaudeAlbumToolAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: "image";
};

export type ClaudeAlbumRuntimeSaveInput = {
  sourceAttachmentId: string;
  description: string | null;
  whySaved: string;
  tags: string[];
};

export type NativeLiveClaudeAlbumRuntimeHandlers = {
  savePhoto(input: ClaudeAlbumRuntimeSaveInput): Promise<{
    photo: ClaudeAlbumToolPhoto;
    created: boolean;
  }>;
  searchPhotos(input: {
    query: string | null;
    limit: number;
  }): Promise<ClaudeAlbumToolPhoto[]>;
  viewPhoto(input: {
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    image: ClaudeAlbumToolImage;
  }>;
  sendPhoto(input: {
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    attachment: ClaudeAlbumToolAttachment;
  }>;
};

export interface NativeLiveClaudeAlbumToolClient {
  savePhoto(input: ClaudeAlbumRuntimeSaveInput & {
    triggerUserMessageId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    created: boolean;
  }>;
  searchPhotos(input: {
    query: string | null;
    limit: number;
  }): Promise<ClaudeAlbumToolPhoto[]>;
  viewPhoto(input: {
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    image: ClaudeAlbumToolImage;
  }>;
  sendPhoto(input: {
    photoId: string;
  }): Promise<{
    photo: ClaudeAlbumToolPhoto;
    attachment: ClaudeAlbumToolAttachment;
  }>;
}

export function projectClaudeAlbumToolPhoto(
  photo: ClaudeAlbumPhoto,
): ClaudeAlbumToolPhoto {
  return {
    id: photo.id,
    filename: photo.filename,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    sha256: photo.sha256,
    description: photo.description,
    whySaved: photo.whySaved,
    tags: [...photo.tags],
    sourceAttachmentId: photo.sourceAttachmentId,
    sourceMessageId: photo.sourceMessageId,
    createdAt: photo.createdAt,
  };
}

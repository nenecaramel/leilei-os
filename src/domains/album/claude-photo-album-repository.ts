import {
  and,
  desc,
  eq,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  claudeAlbumPhotos,
} from "../../database/schema.js";
import type {
  ClaudeAlbumPhoto,
  ClaudeAlbumPhotoRepository,
  ClaudeAlbumSearchInput,
} from "./claude-photo-album-types.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleClaudeAlbumPhotoRepository
implements ClaudeAlbumPhotoRepository {
  constructor(private readonly db: Database) {}

  async findBySourceAttachment(input: {
    userId: string;
    sourceAttachmentId: string;
  }): Promise<ClaudeAlbumPhoto | null> {
    const [row] = await this.db
      .select()
      .from(claudeAlbumPhotos)
      .where(and(
        eq(claudeAlbumPhotos.userId, input.userId),
        eq(
          claudeAlbumPhotos.sourceAttachmentId,
          input.sourceAttachmentId,
        ),
      ))
      .limit(1);
    return row ? mapPhoto(row) : null;
  }

  async create(input: {
    photo: ClaudeAlbumPhoto;
  }): Promise<
    | { outcome: "created"; photo: ClaudeAlbumPhoto }
    | { outcome: "source_exists"; photo: ClaudeAlbumPhoto }
  > {
    const [created] = await this.db
      .insert(claudeAlbumPhotos)
      .values({
        id: input.photo.id,
        userId: input.photo.userId,
        objectKey: input.photo.objectKey,
        filename: input.photo.filename,
        mimeType: input.photo.mimeType,
        sizeBytes: input.photo.sizeBytes,
        sha256: input.photo.sha256,
        description: input.photo.description,
        whySaved: input.photo.whySaved,
        tags: input.photo.tags,
        sourceAttachmentId: input.photo.sourceAttachmentId,
        sourceMessageId: input.photo.sourceMessageId,
        triggerUserMessageId: input.photo.triggerUserMessageId,
        createdAt: new Date(input.photo.createdAt),
        updatedAt: new Date(input.photo.createdAt),
      })
      .onConflictDoNothing({
        target: [
          claudeAlbumPhotos.userId,
          claudeAlbumPhotos.sourceAttachmentId,
        ],
      })
      .returning();

    if (created) {
      return { outcome: "created", photo: mapPhoto(created) };
    }

    const existing = await this.findBySourceAttachment({
      userId: input.photo.userId,
      sourceAttachmentId: input.photo.sourceAttachmentId,
    });
    if (!existing) {
      throw new Error(
        "Claude album source conflict did not resolve to an existing photo.",
      );
    }
    return { outcome: "source_exists", photo: existing };
  }

  async get(input: {
    userId: string;
    photoId: string;
  }): Promise<ClaudeAlbumPhoto | null> {
    const [row] = await this.db
      .select()
      .from(claudeAlbumPhotos)
      .where(and(
        eq(claudeAlbumPhotos.userId, input.userId),
        eq(claudeAlbumPhotos.id, input.photoId),
      ))
      .limit(1);
    return row ? mapPhoto(row) : null;
  }

  async search(
    input: ClaudeAlbumSearchInput,
  ): Promise<ClaudeAlbumPhoto[]> {
    const pattern = input.query ? "%" + input.query + "%" : null;
    const rows = await this.db
      .select()
      .from(claudeAlbumPhotos)
      .where(and(
        eq(claudeAlbumPhotos.userId, input.userId),
        ...(pattern
          ? [
              or(
                ilike(claudeAlbumPhotos.filename, pattern),
                ilike(claudeAlbumPhotos.description, pattern),
                ilike(claudeAlbumPhotos.whySaved, pattern),
                sql`array_to_string(${claudeAlbumPhotos.tags}, ' ') ILIKE ${pattern}`,
              )!,
            ]
          : []),
      ))
      .orderBy(
        desc(claudeAlbumPhotos.createdAt),
        desc(claudeAlbumPhotos.id),
      )
      .limit(input.limit);
    return rows.map(mapPhoto);
  }

  async countByTriggerUserMessage(input: {
    userId: string;
    userMessageId: string;
  }): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(claudeAlbumPhotos)
      .where(and(
        eq(claudeAlbumPhotos.userId, input.userId),
        eq(
          claudeAlbumPhotos.triggerUserMessageId,
          input.userMessageId,
        ),
      ));
    return row?.count ?? 0;
  }
}

function mapPhoto(
  row: typeof claudeAlbumPhotos.$inferSelect,
): ClaudeAlbumPhoto {
  return {
    id: row.id,
    userId: row.userId,
    objectKey: row.objectKey,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    description: row.description,
    whySaved: row.whySaved,
    tags: [...row.tags],
    sourceAttachmentId: row.sourceAttachmentId,
    sourceMessageId: row.sourceMessageId,
    triggerUserMessageId: row.triggerUserMessageId,
    createdAt: row.createdAt.toISOString(),
  };
}

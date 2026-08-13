import type { NotionJsonObject } from "./notion-transport.js";
import { NotionTransport } from "./notion-transport.js";

export class NotionMeetingNoteClient {
  constructor(private readonly transport: NotionTransport) {}

  createMeetingNote(body: NotionJsonObject): Promise<NotionJsonObject> {
    return this.transport.requestJson("/blocks/meeting_notes", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { claudeCodeRecallReceipts } from "../../../database/schema.js";
import { requireActiveUserInTransaction } from "../../require-active-user-transaction.js";
import { applyFinalizedMemoryRecall } from "../subject-state/subject-state-runtime-repository.js";
import type { MemoryLifecyclePolicy } from "../lifecycle/memory-lifecycle.js";
import { DEFAULT_BREATH_RECALL_SALIENCE_BOOST } from "./default-backend-mind-runtime.js";

const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const SIGNED_RECEIPT_PREFIX = "v1";
const SIGNING_LABEL = "leileios/claude-code-recall/signed-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const PAYLOAD_FIELDS = ["v", "id", "uid", "sid", "cid", "ep", "ids", "hash", "iat", "exp"];

export type RecallReceiptInput = {
  userId: string; subjectId: string; conversationId: string; contextEpoch: number;
  stateIds: string[]; contextSha256: string; recalledAt: string;
};
export type RecallConfirmation = {outcome: "confirmed" | "replayed"};
export type SignedRecallReceipt = {
  recall_id: string;
  context_sha256: string;
  recall_token: string;
};
export interface ClaudeCodeRecallReceiptPort {
  create(input: RecallReceiptInput): Promise<{recall_id: string; context_sha256: string}>;
  issueSigned?(input: RecallReceiptInput): Promise<SignedRecallReceipt>;
  confirm(input: {userId: string; recallId: string; contextSha256: string}): Promise<RecallConfirmation>;
  confirmSigned?(input: {userId: string; recallId: string; recallToken: string; contextSha256: string}): Promise<RecallConfirmation>;
}

type SignedReceiptPayload = {
  v: 1;
  id: string;
  uid: string;
  sid: string;
  cid: string;
  ep: number;
  ids: string[];
  hash: string;
  iat: number;
  exp: number;
};

function unavailable(): never {
  throw new Error("RECALL_RECEIPT_UNAVAILABLE");
}

function validReceiptInput(input: RecallReceiptInput): boolean {
  const recalledAt = Date.parse(input.recalledAt);
  return UUID.test(input.userId)
    && input.subjectId.trim().length > 0
    && input.subjectId.length <= 256
    && input.conversationId.startsWith("claude-code:")
    && input.conversationId.length > 12
    && input.conversationId.length <= 268
    && Number.isInteger(input.contextEpoch)
    && input.contextEpoch >= 0
    && input.contextEpoch <= 2147483647
    && input.stateIds.length >= 1
    && input.stateIds.length <= 4
    && input.stateIds.every(id => UUID.test(id))
    && SHA256.test(input.contextSha256)
    && Number.isFinite(recalledAt)
    && Number.isFinite(new Date(recalledAt + RECEIPT_TTL_MS).getTime());
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function matchesPayload(
  row: typeof claudeCodeRecallReceipts.$inferSelect,
  payload: SignedReceiptPayload,
): boolean {
  return row.userId === payload.uid
    && row.subjectId === payload.sid
    && row.conversationId === payload.cid
    && row.contextEpoch === payload.ep
    && sameIds(row.stateIds, payload.ids)
    && row.contextSha256 === payload.hash
    && row.recalledAt.getTime() === payload.iat
    && row.expiresAt.getTime() === payload.exp;
}

export class DrizzleClaudeCodeRecallReceipts implements ClaudeCodeRecallReceiptPort {
  private readonly signedReceiptKey: Buffer | null;

  constructor(
    private readonly db: ReturnType<typeof createDatabase>["db"],
    private readonly lifecyclePolicy?: MemoryLifecyclePolicy,
    signingSecret?: string,
  ) {
    this.signedReceiptKey = signingSecret && signingSecret.length >= 32
      ? createHmac("sha256", signingSecret).update(SIGNING_LABEL).digest()
      : null;
  }

  async create(input: RecallReceiptInput) {
    const id = randomUUID();
    await this.db.transaction(async transaction => {
      await requireActiveUserInTransaction(transaction, input.userId);
      await transaction.insert(claudeCodeRecallReceipts).values({
        id, userId: input.userId, subjectId: input.subjectId, conversationId: input.conversationId,
        contextEpoch: input.contextEpoch, stateIds: input.stateIds, contextSha256: input.contextSha256,
        recalledAt: new Date(input.recalledAt), expiresAt: new Date(Date.parse(input.recalledAt) + RECEIPT_TTL_MS),
      });
      // Legacy V2 rolling compatibility: old hooks still use durable pending receipts.
      await transaction.execute(sql`WITH expired AS MATERIALIZED (
        SELECT id FROM claude_code_recall_receipts WHERE user_id = ${input.userId}::uuid
        AND expires_at < clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      ) DELETE FROM claude_code_recall_receipts WHERE id IN (SELECT id FROM expired)`);
    });
    return {recall_id: id, context_sha256: input.contextSha256};
  }

  async issueSigned(input: RecallReceiptInput): Promise<SignedRecallReceipt> {
    if (!this.signedReceiptKey || !validReceiptInput(input)) unavailable();
    const iat = Date.parse(input.recalledAt);
    const payload: SignedReceiptPayload = {
      v: 1,
      id: randomUUID(),
      uid: input.userId,
      sid: input.subjectId,
      cid: input.conversationId,
      ep: input.contextEpoch,
      ids: [...input.stateIds],
      hash: input.contextSha256,
      iat,
      exp: iat + RECEIPT_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const unsigned = `${SIGNED_RECEIPT_PREFIX}.${encoded}`;
    const signature = createHmac("sha256", this.signedReceiptKey).update(unsigned).digest("base64url");
    return {
      recall_id: payload.id,
      context_sha256: payload.hash,
      recall_token: `${unsigned}.${signature}`,
    };
  }

  private verifySigned(token: string): SignedReceiptPayload {
    if (!this.signedReceiptKey || token.length < 80 || token.length > 4096) unavailable();
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== SIGNED_RECEIPT_PREFIX) unavailable();
    // Buffer's base64url decoder accepts padding, junk and nonzero unused bits.
    // Require the one canonical representation of both encoded segments.
    if (!parts.slice(1).every(part => /^[A-Za-z0-9_-]+$/.test(part)
      && Buffer.from(part, "base64url").toString("base64url") === part)) unavailable();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(parts[2]!, "base64url");
    } catch {
      unavailable();
    }
    const expected = createHmac("sha256", this.signedReceiptKey)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) unavailable();

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    } catch {
      unavailable();
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) unavailable();
    const value = payload as Partial<SignedReceiptPayload>;
    if (
      Object.keys(value).length !== PAYLOAD_FIELDS.length
      || !Object.keys(value).every(field => PAYLOAD_FIELDS.includes(field))
      || value.v !== 1
      || typeof value.id !== "string" || !UUID.test(value.id)
      || typeof value.uid !== "string" || !UUID.test(value.uid)
      || typeof value.sid !== "string" || !value.sid.trim() || value.sid.length > 256
      || typeof value.cid !== "string" || !value.cid.startsWith("claude-code:") || value.cid.length <= 12 || value.cid.length > 268
      || !Number.isInteger(value.ep) || (value.ep as number) < 0 || (value.ep as number) > 2147483647
      || !Array.isArray(value.ids) || value.ids.length < 1 || value.ids.length > 4 || !value.ids.every(id => typeof id === "string" && UUID.test(id))
      || typeof value.hash !== "string" || !SHA256.test(value.hash)
      || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)
      || !Number.isFinite(new Date(value.iat as number).getTime())
      || !Number.isFinite(new Date(value.exp as number).getTime())
      || (value.exp as number) - (value.iat as number) !== RECEIPT_TTL_MS
    ) unavailable();
    return value as SignedReceiptPayload;
  }

  async confirm(input: {userId: string; recallId: string; contextSha256: string}): Promise<RecallConfirmation> {
    return this.db.transaction(async transaction => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [receipt] = await transaction.select().from(claudeCodeRecallReceipts)
        .where(and(eq(claudeCodeRecallReceipts.id, input.recallId), eq(claudeCodeRecallReceipts.userId, input.userId)))
        .for("update").limit(1);
      if (!receipt || receipt.contextSha256 !== input.contextSha256) unavailable();
      if (receipt.confirmedAt) return {outcome: "replayed"};
      const [clock] = await transaction.execute<{now: Date}>(sql`SELECT clock_timestamp() AS now`);
      const now = new Date(clock!.now);
      if (receipt.expiresAt <= now) unavailable();
      await applyFinalizedMemoryRecall(transaction, {
        userId: receipt.userId, subjectId: receipt.subjectId, stateIds: receipt.stateIds,
        recalledAt: receipt.recalledAt.toISOString(), sourceId: receipt.id,
        conversationId: receipt.conversationId, contextEpoch: receipt.contextEpoch,
        salienceBoost: DEFAULT_BREATH_RECALL_SALIENCE_BOOST, lifecyclePolicy: this.lifecyclePolicy, globalOnly: true,
      });
      await transaction.update(claudeCodeRecallReceipts).set({confirmedAt: now}).where(eq(claudeCodeRecallReceipts.id, receipt.id));
      return {outcome: "confirmed"};
    });
  }

  async confirmSigned(input: {
    userId: string;
    recallId: string;
    recallToken: string;
    contextSha256: string;
  }): Promise<RecallConfirmation> {
    const payload = this.verifySigned(input.recallToken);
    if (
      payload.uid !== input.userId
      || payload.id !== input.recallId
      || payload.hash !== input.contextSha256
    ) unavailable();

    return this.db.transaction(async transaction => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const checkExpiry = async () => {
        const [clock] = await transaction.execute<{now: Date}>(sql`SELECT clock_timestamp() AS now`);
        const now = new Date(clock!.now);
        if (payload.exp <= now.getTime()) unavailable();
        return now;
      };
      const now = await checkExpiry();
      // Signed mode does no recall-time writes, so perform the bounded retention
      // cleanup here instead of letting confirmed rows accumulate indefinitely.
      // Materialize once: a nested-loop IN subquery can rescan the LIMIT and
      // delete more than 100 rows as earlier matches disappear during DELETE.
      await transaction.execute(sql`WITH expired AS MATERIALIZED (
        SELECT id FROM claude_code_recall_receipts WHERE user_id = ${input.userId}::uuid
        AND expires_at < clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
      ) DELETE FROM claude_code_recall_receipts WHERE id IN (SELECT id FROM expired)`);

      const [inserted] = await transaction.insert(claudeCodeRecallReceipts).values({
        id: payload.id,
        userId: payload.uid,
        subjectId: payload.sid,
        conversationId: payload.cid,
        contextEpoch: payload.ep,
        stateIds: payload.ids,
        contextSha256: payload.hash,
        recalledAt: new Date(payload.iat),
        expiresAt: new Date(payload.exp),
        confirmedAt: now,
      }).onConflictDoNothing().returning({id: claudeCodeRecallReceipts.id});

      if (!inserted) {
        // This separate statement gets a fresh READ COMMITTED snapshot after
        // the unique-index conflict has waited for the winning transaction.
        const [existing] = await transaction.select().from(claudeCodeRecallReceipts)
          .where(and(eq(claudeCodeRecallReceipts.id, payload.id), eq(claudeCodeRecallReceipts.userId, input.userId)))
          .for("update").limit(1);
        if (!existing || !existing.confirmedAt || !matchesPayload(existing, payload)) unavailable();
        await checkExpiry();
        return {outcome: "replayed"};
      }

      // Cleanup/unique-index waits may outlive the token. Any provisional insert
      // rolls back if it expired before we can apply lifecycle accounting.
      await checkExpiry();
      await applyFinalizedMemoryRecall(transaction, {
        userId: payload.uid,
        subjectId: payload.sid,
        stateIds: payload.ids,
        recalledAt: new Date(payload.iat).toISOString(),
        sourceId: payload.id,
        conversationId: payload.cid,
        contextEpoch: payload.ep,
        salienceBoost: DEFAULT_BREATH_RECALL_SALIENCE_BOOST,
        lifecyclePolicy: this.lifecyclePolicy,
        globalOnly: true,
      });
      return {outcome: "confirmed"};
    });
  }
}

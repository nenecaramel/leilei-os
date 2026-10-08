import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  users,
  runtimeSubjectStates,
  productCreateIdempotency,
} from "../src/database/schema.js";
import { DrizzleMindProductRepository } from "../src/domains/runtime/mind/mind-product-repository.js";
import { MindProductService } from "../src/domains/runtime/mind/mind-product-service.js";
import { DrizzleClaudeCodeRecallReceipts } from "../src/domains/runtime/mind/claude-code-recall-receipts.js";
import { readSubjectStateTemporal } from "../src/domains/runtime/subject-state/subject-state-temporal.js";

const enabled = process.env.RUN_RUNTIME_MIND_PRODUCT_DATABASE_TEST === "1";
test(
  "Memory query, in-place edit and Stop concurrency use canonical PostgreSQL state",
  { skip: !enabled },
  async (t) => {
    const url = process.env.DATABASE_URL!;
    const parsed = new URL(url);
    assert.ok(
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
        /test|scratch|regression/.test(parsed.pathname),
      "isolated local test database required",
    );
    const db = createDatabase(url, { ssl: false });
    const [user] = await db.db
      .insert(users)
      .values({
        email: `memory-api-${crypto.randomUUID()}@example.com`,
        displayName: "Memory API test",
      })
      .returning();
    assert.ok(user);
    t.after(async () => {
      await db.db
        .delete(runtimeSubjectStates)
        .where(eq(runtimeSubjectStates.userId, user.id));
      await db.db
        .delete(productCreateIdempotency)
        .where(eq(productCreateIdempotency.userId, user.id));
      await db.db.delete(users).where(eq(users.id, user.id));
      await db.close();
    });
    const repo = new DrizzleMindProductRepository(db.db);
    const service = new MindProductService(repo, "G");
    const make = (text: string, occurredAt: string | null) =>
      service.createManual({
        userId: user.id,
        kind: "memory",
        text,
        occurredAt,
        idempotencyKey: crypto.randomUUID(),
      });
    const dayStart = await make("marker midnight", "2026-10-07T16:00:00Z");
    const dayLast = await make("marker end", "2026-10-08T15:59:59.999Z");
    const before = await make("marker before", "2026-10-07T15:59:59.999Z");
    const after = await make("marker after", "2026-10-08T16:00:00Z");
    const undated = await make("marker undated", null);
    await t.test(
      "date boundaries, undated preservation and read-only lookup",
      async () => {
        const snapshot = await repo.get({
          userId: user.id,
          subjectId: "G",
          stateId: dayStart.id,
        });
        const page = await service.readDay({
          userId: user.id,
          date: "2026-10-08",
        });
        assert.deepEqual(
          new Set(page.items.map((x) => x.id)),
          new Set([dayStart.id, dayLast.id]),
        );
        const firstPage = await service.readDay({
          userId: user.id,
          date: "2026-10-08",
          limit: 1,
        });
        assert.ok(firstPage.nextCursor);
        const secondPage = await service.readDay({
          userId: user.id,
          date: "2026-10-08",
          limit: 1,
          cursor: firstPage.nextCursor,
        });
        assert.equal(secondPage.nextCursor, null);
        assert.deepEqual(
          new Set(
            [...firstPage.items, ...secondPage.items].map((item) => item.id),
          ),
          new Set([dayStart.id, dayLast.id]),
        );
        assert.equal(
          (await service.search({ userId: user.id, query: "marker" })).items
            .length,
          5,
        );
        assert.ok(
          (
            await service.search({ userId: user.id, query: "marker" })
          ).items.some((x) => x.id === undated.id && x.date === null),
        );
        assert.deepEqual(
          await repo.get({
            userId: user.id,
            subjectId: "G",
            stateId: dayStart.id,
          }),
          snapshot,
        );
        assert.deepEqual(
          (
            await service.search({
              userId: user.id,
              query: "before",
              dateFrom: "2026-10-08",
            })
          ).items,
          [],
        );
        assert.deepEqual(
          (
            await service.search({
              userId: user.id,
              query: "after",
              dateTo: "2026-10-08",
            })
          ).items,
          [],
        );
      },
    );
    await t.test(
      "cursor retains microseconds, ties and immunity to Stop updatedAt",
      async () => {
        await db.db.execute(
          sql`UPDATE runtime_subject_states SET created_at='2026-10-08T00:00:00.123456Z' WHERE user_id=${user.id}::uuid`,
        );
        const ids: string[] = [];
        let cursor: string | null = null;
        do {
          const p = await service.search({
            userId: user.id,
            query: "marker",
            limit: 1,
            cursor,
          });
          ids.push(...p.items.map((x) => x.id));
          cursor = p.nextCursor;
          await db.db.execute(
            sql`UPDATE runtime_subject_states SET updated_at=clock_timestamp() WHERE user_id=${user.id}::uuid`,
          );
        } while (cursor);
        assert.equal(ids.length, 5);
        assert.equal(new Set(ids).size, 5);
      },
    );
    await t.test(
      "literal keywords, malformed temporal metadata and foreign scopes",
      async () => {
        const special = await make(
          "literal 100%_marker",
          "2026-10-08T00:00:00Z",
        );
        await make("literal 100xxmarker", null);
        assert.deepEqual(
          (await service.search({ userId: user.id, query: "100%_" })).items.map(
            (x) => x.id,
          ),
          [special.id],
        );
        assert.deepEqual(
          (await service.search({ userId: user.id, query: "not present" }))
            .items,
          [],
        );
        const unicode = await make("cafe\u0301\n  preference", null);
        assert.deepEqual(
          (
            await service.search({ userId: user.id, query: "CAFÉ preference" })
          ).items.map((x) => x.id),
          [unicode.id],
        );
        assert.deepEqual(
          (
            await new MindProductService(repo, "other").search({
              userId: user.id,
            })
          ).items,
          [],
        );
        assert.deepEqual(
          (await service.search({ userId: crypto.randomUUID() })).items,
          [],
        );
        await assert.rejects(
          service.update({
            userId: user.id,
            stateId: crypto.randomUUID(),
            text: "x",
            expectedVersion: special.contentVersion,
          }),
          { code: "MIND_NOT_FOUND" },
        );
        await db.db
          .update(runtimeSubjectStates)
          .set({
            payload: {
              temporal_v1: {
                basis: "user_supplied",
                occurredAt: "2026-99-99T00:00:00Z",
              },
            },
          })
          .where(eq(runtimeSubjectStates.id, special.id));
        assert.ok(
          !(
            await service.readDay({ userId: user.id, date: "2026-10-08" })
          ).items.some((x) => x.id === special.id),
        );
      },
    );
    await t.test(
      "edits reject foreign subjects and inactive users without changing content",
      async () => {
        const current = await service.get({
          userId: user.id,
          stateId: before.id,
        });
        const patch = {
          userId: user.id,
          stateId: before.id,
          expectedVersion: current.contentVersion,
          text: "must not apply",
        };
        await assert.rejects(
          new MindProductService(repo, "other").update(patch),
          { code: "MIND_NOT_FOUND" },
        );
        await db.db
          .update(users)
          .set({ status: "disabled" })
          .where(eq(users.id, user.id));
        try {
          await assert.rejects(service.update(patch), {
            code: "USER_DISABLED",
          });
        } finally {
          await db.db
            .update(users)
            .set({ status: "active" })
            .where(eq(users.id, user.id));
        }
        assert.equal(
          (await service.get({ userId: user.id, stateId: before.id })).text,
          current.text,
        );
      },
    );
    await t.test(
      "partial edits keep ID/provenance and normalize or clear temporal metadata",
      async () => {
        const original = await repo.get({
          userId: user.id,
          subjectId: "G",
          stateId: undated.id,
        });
        assert.ok(original);
        const edited = await service.update({
          userId: user.id,
          stateId: undated.id,
          expectedVersion: undated.contentVersion,
          text: "edited searchable",
          occurredAt: "2026-10-09T01:00:00+08:00",
        });
        assert.equal(edited.id, undated.id);
        assert.equal(edited.occurredAt, "2026-10-08T17:00:00.000Z");
        assert.equal(
          (await service.get({ userId: user.id, stateId: undated.id })).text,
          "edited searchable",
        );
        assert.deepEqual(
          (
            await service.search({
              userId: user.id,
              query: "edited searchable",
            })
          ).items.map((x) => x.id),
          [undated.id],
        );
        const stored = await repo.get({
          userId: user.id,
          subjectId: "G",
          stateId: undated.id,
        });
        assert.ok(stored);
        assert.deepEqual(stored.envelope, original.envelope);
        assert.equal(stored.createdAt, original.createdAt);
        assert.deepEqual(readSubjectStateTemporal(stored.payload), {
          occurredAt: "2026-10-08T17:00:00.000Z",
          basis: "user_supplied",
          sourceMessageId: null,
        });
        const cleared = await service.update({
          userId: user.id,
          stateId: edited.id,
          expectedVersion: edited.contentVersion,
          occurredAt: null,
        });
        assert.equal(cleared.occurredAt, null);
        assert.equal(cleared.text, edited.text);
        assert.ok(
          !(
            await service.readDay({ userId: user.id, date: "2026-10-09" })
          ).items.some((x) => x.id === edited.id),
        );
      },
    );
    await t.test(
      "legacy manual dates use the same temporal interpretation as detail reads",
      async () => {
        const legacy = await make("legacy dated", null);
        await db.db
          .update(runtimeSubjectStates)
          .set({
            payload: {
              manual_v1: { occurredAt: " 2026-10-10 ", note: "retained" },
            },
          })
          .where(eq(runtimeSubjectStates.id, legacy.id));
        const detail = await service.get({
          userId: user.id,
          stateId: legacy.id,
        });
        assert.equal(detail.occurredAt, "2026-10-10T00:00:00.000Z");
        const first = await service.readDay({
          userId: user.id,
          date: "2026-10-10",
          limit: 1,
        });
        assert.ok(first.items.some((item) => item.id === legacy.id));
        const cleared = await service.update({
          userId: user.id,
          stateId: legacy.id,
          expectedVersion: detail.contentVersion,
          occurredAt: null,
        });
        assert.equal(cleared.occurredAt, null);
        assert.equal(cleared.note, "retained");
        assert.ok(
          !(
            await service.readDay({ userId: user.id, date: "2026-10-10" })
          ).items.some((item) => item.id === legacy.id),
        );
      },
    );
    await t.test(
      "two editors cannot silently overwrite the same content version",
      async () => {
        const initial = await service.get({
          userId: user.id,
          stateId: before.id,
        });
        const results = await Promise.allSettled(
          ["one", "two"].map((text) =>
            service.update({
              userId: user.id,
              stateId: before.id,
              expectedVersion: initial.contentVersion,
              text,
            }),
          ),
        );
        assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
        const rejected = results.find((x) => x.status === "rejected");
        assert.ok(rejected && rejected.status === "rejected");
        assert.equal(rejected.reason.code, "MIND_CONFLICT");
      },
    );
    await t.test(
      "source-message date edited explicitly becomes user-supplied without changing provenance",
      async () => {
        const state = await make("source dated", null);
        await db.db
          .update(runtimeSubjectStates)
          .set({
            payload: {
              temporal_v1: {
                occurredAt: "2026-10-08T00:00:00Z",
                basis: "source_message",
                sourceMessageId: crypto.randomUUID(),
              },
              lifecycle_v1: {
                status: "active",
                salience: 1,
                protected: false,
                lastDecayedAt: new Date().toISOString(),
                lastRecalledAt: null,
                archivedAt: null,
                forgottenAt: null,
              },
            },
          })
          .where(eq(runtimeSubjectStates.id, state.id));
        const current = await service.get({
          userId: user.id,
          stateId: state.id,
        });
        const textEdit = await service.update({
          userId: user.id,
          stateId: state.id,
          expectedVersion: current.contentVersion,
          text: "source text edited",
        });
        assert.equal(
          readSubjectStateTemporal(
            (
              await repo.get({
                userId: user.id,
                subjectId: "G",
                stateId: state.id,
              })
            )?.payload,
          )?.basis,
          "source_message",
        );
        await service.update({
          userId: user.id,
          stateId: state.id,
          expectedVersion: textEdit.contentVersion,
          occurredAt: "2026-10-09T00:00:00Z",
        });
        const row = await repo.get({
          userId: user.id,
          subjectId: "G",
          stateId: state.id,
        });
        assert.equal(
          readSubjectStateTemporal(row?.payload)?.basis,
          "user_supplied",
        );
      },
    );
    await t.test(
      "hidden_system is excluded while subject_private remains readable and editable",
      async () => {
        const hidden = await make(
          "visibility regression hidden",
          "2026-10-12T00:00:00Z",
        );
        const visible = await make(
          "visibility regression private",
          "2026-10-12T00:00:00Z",
        );
        await db.db.execute(
          sql`UPDATE runtime_subject_states SET envelope=jsonb_set(envelope, '{scope,visibility}', '"hidden_system"') WHERE id=${hidden.id}::uuid`,
        );
        await db.db.execute(
          sql`UPDATE runtime_subject_states SET envelope=jsonb_set(envelope, '{scope,visibility}', '"subject_private"') WHERE id=${visible.id}::uuid`,
        );
        assert.deepEqual(
          (
            await service.search({
              userId: user.id,
              query: "visibility regression",
            })
          ).items.map((x) => x.id),
          [visible.id],
        );
        assert.ok(
          !(await service.list({ userId: user.id })).items.some(
            (x) => x.id === hidden.id,
          ),
        );
        assert.deepEqual(
          (
            await service.readDay({ userId: user.id, date: "2026-10-12" })
          ).items.map((x) => x.id),
          [visible.id],
        );
        await assert.rejects(
          service.get({ userId: user.id, stateId: hidden.id }),
          { code: "MIND_NOT_FOUND" },
        );
        await assert.rejects(
          service.update({
            userId: user.id,
            stateId: hidden.id,
            expectedVersion: hidden.contentVersion,
            text: "must not apply",
          }),
          { code: "MIND_NOT_FOUND" },
        );
        assert.equal(
          (await service.get({ userId: user.id, stateId: visible.id })).id,
          visible.id,
        );
        assert.equal(
          (
            await service.update({
              userId: user.id,
              stateId: visible.id,
              expectedVersion: visible.contentVersion,
              text: "private edited",
            })
          ).text,
          "private edited",
        );
        const [stored] = await db.db
          .select({ text: runtimeSubjectStates.text })
          .from(runtimeSubjectStates)
          .where(eq(runtimeSubjectStates.id, hidden.id));
        assert.equal(stored!.text, hidden.text);
      },
    );
    await t.test(
      "historical dates have identical detail, day and undated semantics without rewrites",
      async () => {
        const cases: Array<[string, string | null]> = [
          ["2026-10-13t00:00:00z", "2026-10-13T00:00:00.000Z"],
          ["2026-10-13T00:00Z", "2026-10-13T00:00:00.000Z"],
          ["2026-10-13 00:00:00+0000", "2026-10-13T00:00:00.000Z"],
          [
            "\u00a0\u20032026-10-13T00:00:00Z\ufeff",
            "2026-10-13T00:00:00.000Z",
          ],
          ["2026-02-29T00:00:00Z", null],
          ["2026-10-13T24:00:00Z", null],
          ["2026-10-13T00:00:60Z", null],
          ["not-a-date", null],

          ["\t\n2026-10-13T00:00:00Z\r\n", "2026-10-13T00:00:00.000Z"],
          ["2026-02-30T00:00:00Z", null],
          ["2026-10-13T15:59:59.999999999Z", "2026-10-13T15:59:59.999Z"],
          ["2026-10-13T00:00:00+08:00", "2026-10-12T16:00:00.000Z"],
        ];
        for (const legacy of [false, true])
          for (const [raw, expected] of cases) {
            const item = await make("temporal consistency regression", null);
            const payload = legacy
              ? { manual_v1: { occurredAt: raw } }
              : {
                  temporal_v1: {
                    basis: "user_supplied",
                    sourceMessageId: null,
                    occurredAt: raw,
                  },
                };
            await db.db
              .update(runtimeSubjectStates)
              .set({ payload })
              .where(eq(runtimeSubjectStates.id, item.id));
            const snapshot = await repo.get({
              userId: user.id,
              subjectId: "G",
              stateId: item.id,
            });
            assert.equal(
              (await service.get({ userId: user.id, stateId: item.id }))
                .occurredAt,
              expected,
              raw,
            );
            const day = await service.readDay({
              userId: user.id,
              date: "2026-10-13",
            });
            assert.equal(
              day.items.some((x) => x.id === item.id),
              expected !== null,
              raw,
            );
            const unknown = await service.search({
              userId: user.id,
              query: "temporal consistency regression",
              undated: true,
            } as any);
            assert.equal(
              unknown.items.some((x) => x.id === item.id),
              expected === null,
              raw,
            );
            assert.deepEqual(
              await repo.get({
                userId: user.id,
                subjectId: "G",
                stateId: item.id,
              }),
              snapshot,
            );
          }
      },
    );
    await t.test(
      "undated filtering happens before pagination and binds the cursor",
      async () => {
        const a = await make("undated pagination regression A", null);
        const b = await make("undated pagination regression B", null);
        await make(
          "undated pagination regression dated newest",
          "2026-10-14T00:00:00Z",
        );
        const input = {
          userId: user.id,
          query: "undated pagination regression",
          undated: true,
          limit: 1,
        };
        const first = await service.search(input as any);
        assert.equal(first.items[0]!.occurredAt, null);
        assert.ok(first.nextCursor);
        const second = await service.search({
          ...input,
          cursor: first.nextCursor,
        } as any);
        assert.equal(second.nextCursor, null);
        assert.deepEqual(
          new Set([...first.items, ...second.items].map((x) => x.id)),
          new Set([a.id, b.id]),
        );
        await assert.rejects(
          service.search({
            ...input,
            undated: false,
            cursor: first.nextCursor,
          } as any),
          { code: "INVALID_MIND" },
        );
        await assert.rejects(
          service.search({ ...input, dateFrom: "2026-10-14" } as any),
          { code: "INVALID_MIND" },
        );
      },
    );
    for (const stopFirst of [true, false])
      await t.test(
        `Stop/edit row-lock ordering (${stopFirst ? "Stop first" : "edit first"}) preserves both writes`,
        async () => {
          const item = await make("Stop concurrent", null);
          const receiptPort = new DrizzleClaudeCodeRecallReceipts(
            db.db,
            undefined,
            "s".repeat(40),
          );
          const recalledAt = new Date().toISOString();
          const receipt = await receiptPort.issueSigned({
            userId: user.id,
            subjectId: "G",
            conversationId: "claude-code:memory-api-test",
            contextEpoch: 2,
            stateIds: [item.id],
            contextSha256: "a".repeat(64),
            recalledAt,
          });
          let release!: () => void;
          let locked!: () => void;
          const gate = new Promise<void>((r) => (release = r));
          const ready = new Promise<void>((r) => (locked = r));
          const lock = db.db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT id FROM runtime_subject_states WHERE id=${item.id}::uuid FOR UPDATE`,
            );
            locked();
            await gate;
          });
          await ready;
          const confirm = () =>
            receiptPort.confirmSigned({
              userId: user.id,
              recallId: receipt.recall_id,
              contextSha256: receipt.context_sha256,
              recallToken: receipt.recall_token,
            });
          const edit = () =>
            service.update({
              userId: user.id,
              stateId: item.id,
              expectedVersion: item.contentVersion,
              text: "latest after Stop",
              occurredAt: "2026-10-08T00:00:00Z",
            });
          const waitForWaiters = async (count: number) => {
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
              const [r] = await db.db.execute<{ count: number }>(
                sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%runtime_subject_states%'`,
              );
              if (r!.count >= count) return;
              await new Promise((r) => setTimeout(r, 10));
            }
            throw Error("row-lock synchronization timed out");
          };
          let first: Promise<unknown> | undefined;
          let second: Promise<unknown> | undefined;
          try {
            first = stopFirst ? confirm() : edit();
            await waitForWaiters(1);
            second = stopFirst ? edit() : confirm();
            await waitForWaiters(2);
          } finally {
            release();
          }
          await lock;
          await Promise.all([first, second]);
          const current = await repo.get({
            userId: user.id,
            subjectId: "G",
            stateId: item.id,
          });
          assert.ok(current);
          assert.equal(current.text, "latest after Stop");
          assert.equal(
            (current.payload?.lifecycle_v1 as any).lastRecalledAt,
            recalledAt,
          );
          assert.equal(
            (current.payload?.recall_context_v1 as any).sourceMessageId,
            receipt.recall_id,
          );
          assert.equal(
            (
              await receiptPort.confirmSigned({
                userId: user.id,
                recallId: receipt.recall_id,
                contextSha256: receipt.context_sha256,
                recallToken: receipt.recall_token,
              })
            ).outcome,
            "replayed",
          );
        },
      );
  },
);

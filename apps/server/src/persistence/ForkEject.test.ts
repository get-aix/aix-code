import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { ejectForkDatabase } from "./ForkEject.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";

describe("ejectForkDatabase", () => {
  it.effect(
    "removes lane request data while preserving regular projections and upstream history",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
        ) VALUES
          ('lane-1', 'thread-1', 1, 'lane_request', 'waiting', '2026-01-01', '{}'),
          ('message-1', 'thread-1', 2, 'assistant_message', 'completed', '2026-01-01', '{}')
      `;
        yield* sql`
        INSERT INTO orchestration_v2_projection_messages (
          message_id, thread_id, role, streaming, created_at, updated_at, payload_json
        ) VALUES ('message-1', 'thread-1', 'assistant', 0, '2026-01-01', '2026-01-01', '{}')
      `;
        yield* sql`
        INSERT INTO orchestration_v2_events (
          event_id, thread_id, event_type, occurred_at, payload_json
        ) VALUES
          ('event-lane', 'thread-1', 'turn-item.updated', '2026-01-01', '{"type":"lane_request"}'),
          ('event-message', 'thread-1', 'turn-item.updated', '2026-01-01', '{"type":"assistant_message"}')
      `;
        const upstreamBefore = yield* sql<{
          readonly migration_id: number;
          readonly name: string;
        }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;

        const summary = yield* ejectForkDatabase();

        assert.deepEqual(summary, {
          dryRun: false,
          laneRequestRows: 1,
          laneRequestEvents: 1,
          forkMigrationRows: 3,
          legacyForkLedgerRows: 0,
          legacyUpstreamRowsToRenumber: 0,
        });
        assert.deepEqual(
          yield* sql<{ readonly turn_item_id: string }>`
          SELECT turn_item_id FROM orchestration_v2_projection_turn_items
        `,
          [{ turn_item_id: "message-1" }],
        );
        assert.deepEqual(
          yield* sql<{
            readonly message_id: string;
          }>`SELECT message_id FROM orchestration_v2_projection_messages`,
          [{ message_id: "message-1" }],
        );
        assert.deepEqual(
          yield* sql<{ readonly event_id: string }>`SELECT event_id FROM orchestration_v2_events`,
          [{ event_id: "event-message" }],
        );
        const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'index'
      `;
        assert.notInclude(
          indexes.map((row) => row.name),
          "orchestration_v2_projection_turn_items_waiting_lane_idx",
        );
        const forkLedger = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fork_migrations'
      `;
        assert.equal(forkLedger.length, 0);
        assert.deepEqual(
          yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
        `,
          upstreamBefore,
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("dry run reports changes but leaves the database untouched", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id, thread_id, ordinal, type, status, updated_at, payload_json
        ) VALUES ('lane-1', 'thread-1', 1, 'lane_request', 'waiting', '2026-01-01', '{}')
      `;

      const summary = yield* ejectForkDatabase({ dryRun: true });

      assert.equal(summary.laneRequestRows, 1);
      assert.isTrue(summary.dryRun);
      assert.equal(
        (yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM orchestration_v2_projection_turn_items WHERE type = 'lane_request'
        `)[0]?.count,
        1,
      );
      assert.equal(
        (yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fork_migrations'
        `).length,
        1,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("normalizes a legacy fork migration ledger during eject", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`DROP TABLE fork_migrations`;
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 97`;
      for (const [id, name] of [
        [97, "ProjectionProjectScope"],
        [98, "ProjectionProjectHomeAixProfile"],
        [99, "WaitingLaneRequestIndex"],
        [100, "IssueTrackerBindings"],
        [101, "ActiveShellIndexIndexes"],
        [102, "BackgroundRecoveryIndexes"],
        [103, "TurnStartReadIndexes"],
        [104, "DelegatedTaskReadIndexes"],
        [105, "ThreadItemCounts"],
      ] as const) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }

      const summary = yield* ejectForkDatabase();

      assert.equal(summary.legacyForkLedgerRows, 3);
      assert.equal(summary.legacyUpstreamRowsToRenumber, 6);
      assert.deepEqual(
        yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
        `,
        migrationManifest.map(([migration_id, name]) => ({ migration_id, name })),
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

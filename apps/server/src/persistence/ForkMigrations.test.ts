import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { hasPendingMigrations, migrationManifest, runMigrations } from "./Migrations.ts";

const forkNames = [
  "ProjectionProjectScope",
  "ProjectionProjectHomeAixProfile",
  "WaitingLaneRequestIndex",
];

describe("fork migrations", () => {
  it.effect("keeps upstream migration ids through 102 and records fork migrations separately", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const max = yield* sql<{ readonly max: number }>`
        SELECT MAX(migration_id) AS max FROM effect_sql_migrations
      `;
      const forkRows = yield* sql<{ readonly name: string }>`
        SELECT name FROM fork_migrations ORDER BY name
      `;

      assert.deepEqual(
        migrationManifest.filter(([id]) => id >= 97 && id <= 102),
        [
          [97, "IssueTrackerBindings"],
          [98, "ActiveShellIndexIndexes"],
          [99, "BackgroundRecoveryIndexes"],
          [100, "TurnStartReadIndexes"],
          [101, "DelegatedTaskReadIndexes"],
          [102, "ThreadItemCounts"],
        ],
      );
      assert.equal(max[0]?.max, migrationManifest.at(-1)?.[0]);
      assert.deepEqual(
        forkRows.map((row) => row.name),
        [...forkNames].sort(),
      );
      assert.isFalse(yield* hasPendingMigrations());
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades a stock upstream 0.1.11 database without changing its ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`DROP INDEX orchestration_v2_projection_turn_items_waiting_lane_idx`;
      yield* sql`DROP TABLE fork_migrations`;
      yield* sql`ALTER TABLE projection_projects DROP COLUMN home_aix_profile`;
      yield* sql`ALTER TABLE projection_projects DROP COLUMN scope`;
      const before = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;

      assert.isTrue(yield* hasPendingMigrations());
      yield* runMigrations();

      const after = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      const forkRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM fork_migrations
      `;
      assert.deepEqual(after, before);
      assert.equal(forkRows[0]?.count, 3);
      assert.isFalse(yield* hasPendingMigrations());
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("normalizes a full legacy fork ledger with shifted upstream 100..105 rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // A legacy fork database predates the upstream migrations after 102.
      yield* runMigrations({ toMigrationInclusive: 102 });
      yield* sql`ALTER TABLE projection_projects ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'`;
      yield* sql`ALTER TABLE projection_projects ADD COLUMN home_aix_profile TEXT`;
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 97`;
      const legacyRows = [
        [97, "ProjectionProjectScope"],
        [98, "ProjectionProjectHomeAixProfile"],
        [99, "WaitingLaneRequestIndex"],
        [100, "IssueTrackerBindings"],
        [101, "ActiveShellIndexIndexes"],
        [102, "BackgroundRecoveryIndexes"],
        [103, "TurnStartReadIndexes"],
        [104, "DelegatedTaskReadIndexes"],
        [105, "ThreadItemCounts"],
      ] as const;
      for (const [id, name] of legacyRows) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }

      assert.isTrue(yield* hasPendingMigrations());
      assert.deepEqual(
        (yield* runMigrations()).map(([id, name]) => [id, name]),
        migrationManifest.filter(([id]) => id > 102).map(([id, name]) => [id, name]),
      );
      assert.deepEqual(
        yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
        `,
        migrationManifest.map(([migration_id, name]) => ({ migration_id, name })),
      );
      assert.isFalse(yield* hasPendingMigrations());
      const forks = yield* sql<{ readonly name: string }>`SELECT name FROM fork_migrations`;
      assert.deepEqual(new Set(forks.map((row) => row.name)), new Set(forkNames));
      const itemCountsTable = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_projection_thread_item_counts'
      `;
      assert.equal(itemCountsTable.length, 1);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("normalizes a legacy fork ledger stopped at 99 and runs upstream 97..102", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 96 });
      yield* sql`ALTER TABLE projection_projects ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'`;
      yield* sql`ALTER TABLE projection_projects ADD COLUMN home_aix_profile TEXT`;
      for (const [id, name] of [
        [97, "ProjectionProjectScope"],
        [98, "ProjectionProjectHomeAixProfile"],
        [99, "WaitingLaneRequestIndex"],
      ] as const) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
      }

      const executed = yield* runMigrations();
      assert.deepEqual(
        executed.map(([id, name]) => [id, name]),
        migrationManifest.filter(([id]) => id >= 97).map(([id, name]) => [id, name]),
      );
      assert.isFalse(yield* hasPendingMigrations());
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect(
    "re-applies a fork migration if its schema disappears while recorded in fork_migrations",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        yield* sql`ALTER TABLE projection_projects DROP COLUMN scope`;

        assert.isTrue(yield* hasPendingMigrations());
        yield* runMigrations();

        const columns = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(projection_projects)`;
        assert.include(
          columns.map((column) => column.name),
          "scope",
        );
        assert.isFalse(yield* hasPendingMigrations());
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("does not run fork migrations for partial toMigrationInclusive runs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 95 });
      const forkLedger = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fork_migrations'
      `;
      assert.equal(forkLedger.length, 0);
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
      assert.notInclude(
        columns.map((column) => column.name),
        "scope",
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

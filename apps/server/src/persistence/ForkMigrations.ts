import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const FORK_MIGRATION_NAMES = [
  "ProjectionProjectScope",
  "ProjectionProjectHomeAixProfile",
  "WaitingLaneRequestIndex",
] as const;

export type ForkMigrationName = (typeof FORK_MIGRATION_NAMES)[number];

export const SHIFTED_UPSTREAM_MIGRATION_IDS = [
  ["IssueTrackerBindings", 97],
  ["ActiveShellIndexIndexes", 98],
  ["BackgroundRecoveryIndexes", 99],
  ["TurnStartReadIndexes", 100],
  ["DelegatedTaskReadIndexes", 101],
  ["ThreadItemCounts", 102],
] as const;

const WAITING_LANE_REQUEST_INDEX_NAME = "orchestration_v2_projection_turn_items_waiting_lane_idx";

const ensureForkLedger = Effect.fn("ForkMigrations.ensureForkLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `;
});

const missingForkSchemaMigrations = Effect.fn("ForkMigrations.missingSchemaMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const projectColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_projects)
    `;
    const projectColumnNames = new Set(projectColumns.map((column) => column.name));
    const indexRows = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = ${WAITING_LANE_REQUEST_INDEX_NAME}
    `;
    const missing = new Set<ForkMigrationName>();
    if (!projectColumnNames.has("scope")) missing.add("ProjectionProjectScope");
    if (!projectColumnNames.has("home_aix_profile")) {
      missing.add("ProjectionProjectHomeAixProfile");
    }
    if (indexRows.length === 0) missing.add("WaitingLaneRequestIndex");
    return missing;
  },
);

export const normalizeLegacyForkMigrationLedger = Effect.fn("ForkMigrations.normalizeLegacyLedger")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
    if (tables.length === 0) return false;

    const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations
  `;
    if (!rows.some((row) => (FORK_MIGRATION_NAMES as readonly string[]).includes(row.name)))
      return false;

    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const name of FORK_MIGRATION_NAMES) {
          yield* sql`DELETE FROM effect_sql_migrations WHERE name = ${name}`;
        }

        const upstreamRows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
      `;
        const idByName = new Map<string, number>(SHIFTED_UPSTREAM_MIGRATION_IDS);
        const changes = upstreamRows.flatMap((row) => {
          const targetId = idByName.get(row.name);
          return targetId === undefined || targetId === row.migration_id
            ? []
            : [{ oldId: row.migration_id, targetId, name: row.name }];
        });

        for (const [index, change] of changes.entries()) {
          yield* sql`
          UPDATE effect_sql_migrations
          SET migration_id = ${-10000 - index}
          WHERE migration_id = ${change.oldId} AND name = ${change.name}
        `;
        }
        for (const change of [...changes].sort((a, b) => a.targetId - b.targetId)) {
          yield* sql`
          UPDATE effect_sql_migrations
          SET migration_id = ${change.targetId}
          WHERE migration_id = ${-10000 - changes.indexOf(change)} AND name = ${change.name}
        `;
        }
      }),
    );
    return true;
  },
);

export const hasPendingLegacyForkMigrationNormalization = Effect.fn(
  "ForkMigrations.hasPendingLegacyNormalization",
)(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return false;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM effect_sql_migrations
    WHERE name IN ('ProjectionProjectScope', 'ProjectionProjectHomeAixProfile', 'WaitingLaneRequestIndex')
    LIMIT 1
  `;
  return rows.length > 0;
});

export const hasPendingForkMigrations = Effect.fn("ForkMigrations.hasPending")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fork_migrations'
  `;
  if (tables.length === 0) return true;
  const rows = yield* sql<{ readonly name: string }>`SELECT name FROM fork_migrations`;
  const applied = new Set(rows.map((row) => row.name));
  if (FORK_MIGRATION_NAMES.some((name) => !applied.has(name))) return true;
  const missingSchema = yield* missingForkSchemaMigrations();
  return missingSchema.size > 0;
});

const applyForkMigration = Effect.fn("ForkMigrations.apply")(function* (name: ForkMigrationName) {
  const sql = yield* SqlClient.SqlClient;
  if (name === "ProjectionProjectScope" || name === "ProjectionProjectHomeAixProfile") {
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
    const columnName = name === "ProjectionProjectScope" ? "scope" : "home_aix_profile";
    if (!columns.some((column) => column.name === columnName)) {
      if (name === "ProjectionProjectScope") {
        yield* sql`ALTER TABLE projection_projects ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'`;
      } else {
        yield* sql`ALTER TABLE projection_projects ADD COLUMN home_aix_profile TEXT`;
      }
    }
  } else {
    yield* sql`
        CREATE INDEX IF NOT EXISTS orchestration_v2_projection_turn_items_waiting_lane_idx
        ON orchestration_v2_projection_turn_items(thread_id, updated_at DESC, turn_item_id DESC)
        WHERE type = 'lane_request' AND status = 'waiting'
      `;
  }
});

export const runForkMigrations = Effect.fn("ForkMigrations.run")(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* hasPendingForkMigrations())) return [];
  yield* ensureForkLedger();
  const missingSchema = yield* missingForkSchemaMigrations();
  const applied: Array<ForkMigrationName> = [];
  for (const name of FORK_MIGRATION_NAMES) {
    const rows = yield* sql<{ readonly name: string }>`
      SELECT name FROM fork_migrations WHERE name = ${name}
    `;
    if (rows.length > 0 && !missingSchema.has(name)) continue;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* applyForkMigration(name);
        yield* sql`INSERT OR REPLACE INTO fork_migrations (name, applied_at) VALUES (${name}, CURRENT_TIMESTAMP)`;
      }),
    );
    applied.push(name);
  }
  return applied;
});

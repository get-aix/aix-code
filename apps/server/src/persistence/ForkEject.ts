import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import {
  FORK_MIGRATION_NAMES,
  SHIFTED_UPSTREAM_MIGRATION_IDS,
  normalizeLegacyForkMigrationLedger,
} from "./ForkMigrations.ts";

export interface ForkEjectSummary {
  readonly dryRun: boolean;
  readonly laneRequestRows: number;
  readonly laneRequestEvents: number;
  readonly forkMigrationRows: number;
  readonly legacyForkLedgerRows: number;
  readonly legacyUpstreamRowsToRenumber: number;
}

const tableExists = Effect.fn("ForkEject.tableExists")(function* (name: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}
    `;
  return rows.length > 0;
});

const countLaneRequestRows = Effect.fn("ForkEject.countLaneRequestRows")(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* tableExists("orchestration_v2_projection_turn_items"))) return 0;
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count
    FROM orchestration_v2_projection_turn_items
    WHERE type = 'lane_request'
  `;
  return rows[0]?.count ?? 0;
});

const countLaneRequestEvents = Effect.fn("ForkEject.countLaneRequestEvents")(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* tableExists("orchestration_v2_events"))) return 0;
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count
    FROM orchestration_v2_events
    WHERE event_type = 'turn-item.updated'
      AND json_extract(payload_json, '$.type') = 'lane_request'
  `;
  return rows[0]?.count ?? 0;
});

export const ejectForkDatabase = Effect.fn("ForkEject.ejectForkDatabase")(function* (
  options: { readonly dryRun?: boolean } = {},
) {
  const sql = yield* SqlClient.SqlClient;
  const dryRun = options.dryRun === true;
  const laneRequestRows = yield* countLaneRequestRows();
  const laneRequestEvents = yield* countLaneRequestEvents();
  const hasForkLedger = yield* tableExists("fork_migrations");
  const forkMigrationRows = hasForkLedger
    ? yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM fork_migrations`.pipe(
        Effect.map((rows) => rows[0]?.count ?? 0),
      )
    : 0;
  const historyExists = yield* tableExists("effect_sql_migrations");
  const history = historyExists
    ? yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
      `
    : [];
  const forkNames = new Set<string>(FORK_MIGRATION_NAMES);
  const upstreamTargets = new Map<string, number>(SHIFTED_UPSTREAM_MIGRATION_IDS);
  const legacyForkLedgerRows = history.filter((row) => forkNames.has(row.name)).length;
  const legacyUpstreamRowsToRenumber = history.filter((row) => {
    const target = upstreamTargets.get(row.name);
    return target !== undefined && target !== row.migration_id;
  }).length;
  const summary: ForkEjectSummary = {
    dryRun,
    laneRequestRows,
    laneRequestEvents,
    forkMigrationRows,
    legacyForkLedgerRows,
    legacyUpstreamRowsToRenumber,
  };

  if (!dryRun) {
    yield* normalizeLegacyForkMigrationLedger();
    yield* sql.withTransaction(
      Effect.gen(function* () {
        if (yield* tableExists("orchestration_v2_projection_turn_items")) {
          yield* sql`
            DELETE FROM orchestration_v2_projection_turn_items WHERE type = 'lane_request'
          `;
        }
        if (yield* tableExists("orchestration_v2_events")) {
          yield* sql`
            DELETE FROM orchestration_v2_events
            WHERE event_type = 'turn-item.updated'
              AND json_extract(payload_json, '$.type') = 'lane_request'
          `;
        }
        yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_turn_items_waiting_lane_idx`;
        yield* sql`DROP TABLE IF EXISTS fork_migrations`;
      }),
    );
  }
  return summary;
});

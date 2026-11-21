import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { Command, Flag, GlobalFlag } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import * as DatabaseMaintenance from "../persistence/DatabaseMaintenance.ts";
import { ejectForkDatabase } from "../persistence/ForkEject.ts";
import * as ServerOwnership from "../serverOwnership.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const lockServerHome = Effect.fn("forkEject.lockServerHome")(function* (paths: {
  readonly dbPath: string;
  readonly serverRuntimeStatePath: string;
}) {
  yield* ServerOwnership.holdServerOwnershipLock(paths.serverRuntimeStatePath).pipe(
    Effect.catchTags({
      ServerAlreadyRunningError: Effect.fn("forkEject.nameServerHolder")(function* (cause) {
        const owner = yield* readPersistedServerRuntimeState(paths.serverRuntimeStatePath).pipe(
          Effect.map(Option.filter((state) => isProcessAlive(state.pid))),
          Effect.orElseSucceed(() => Option.none()),
        );
        return yield* new DatabaseMaintenance.DatabaseInUseError({
          path: paths.dbPath,
          cause,
          ...(Option.isSome(owner) && {
            pid: owner.value.pid,
            serviceManaged: owner.value.serviceManaged === true,
          }),
        });
      }),
    }),
  );
});

export const forkEjectCommand = Command.make("fork-eject", {
  ...projectLocationFlags,
  dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
}).pipe(
  Command.withDescription(
    "Remove fork-only SQLite data and migration state so this database can be opened by upstream T3 Code.",
  ),
  Command.withHandler((flags) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const logLevel = yield* GlobalFlag.LogLevel;
        const paths = yield* resolveCliAuthConfig(flags, logLevel);
        if (!(yield* fs.exists(paths.dbPath))) {
          return yield* new CliError.UserError({
            cause: `T3 Code database not found: ${paths.dbPath}`,
          });
        }
        if (!flags.dryRun) {
          yield* lockServerHome(paths);
        }
        const summary = yield* ejectForkDatabase({ dryRun: flags.dryRun }).pipe(
          Effect.provide(NodeSqliteClient.layer({ filename: paths.dbPath })),
        );
        const action = flags.dryRun ? "Would remove" : "Removed";
        yield* Console.log(
          `${action} ${summary.laneRequestRows} lane_request rows, ${summary.laneRequestEvents} lane_request events, and ${summary.forkMigrationRows} fork migration records.`,
        );
        if (summary.legacyForkLedgerRows > 0 || summary.legacyUpstreamRowsToRenumber > 0) {
          yield* Console.log(
            `${flags.dryRun ? "Would normalize" : "Normalized"} legacy migration ledger (${summary.legacyForkLedgerRows} fork rows, ${summary.legacyUpstreamRowsToRenumber} shifted upstream rows).`,
          );
        }
        yield* Console.log(
          flags.dryRun
            ? "Dry run only; database unchanged."
            : "Database is ready to open with upstream T3 Code.",
        );
      }),
    ),
  ),
);

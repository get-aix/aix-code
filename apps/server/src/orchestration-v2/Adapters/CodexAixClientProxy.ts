import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

import type { CodexAixLaunch } from "../../provider/CodexAixLaunch.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

export class CodexAixRotationError extends Schema.TaggedError<CodexAixRotationError>()(
  "CodexAixRotationError",
  { reason: Schema.Literals(["active-work", "restart-failed"]) },
) {
  override get message(): string {
    return this.reason === "active-work"
      ? "Codex aix credentials changed while the app-server still has active work. Finish that work and start the turn again."
      : "Codex could not restart safely with the refreshed aix credentials. Retry the turn.";
  }
}

type Client = CodexClient.CodexAppServerClient["Service"];

/** A stable client facade lets a Codex session replace its process after AIX credentials rotate. */
export const makeReplaceableCodexClient = Effect.fn(
  "CodexAixClientProxy.makeReplaceableCodexClient",
)(function* (initial: Client) {
  const current = yield* Ref.make(initial);
  const termination = yield* Deferred.make<never, CodexErrors.CodexAppServerError>();
  const notificationRegistrations: Array<(client: Client) => Effect.Effect<void>> = [];
  const requestRegistrations: Array<(client: Client) => Effect.Effect<void>> = [];
  const unknownRequestRegistrations: Array<(client: Client) => Effect.Effect<void>> = [];
  const unknownNotificationRegistrations: Array<(client: Client) => Effect.Effect<void>> = [];
  const retiring = new WeakSet<object>();
  const activityPermit = yield* Semaphore.make(1);
  let activeCalls = 0;
  const useClient = <A, E, R>(use: () => Effect.Effect<A, E, R>, source?: Client) =>
    Effect.acquireUseRelease(
      activityPermit.withPermit(
        Effect.sync(() => {
          if (source !== undefined && retiring.has(source)) return false;
          activeCalls++;
          return true;
        }),
      ),
      (acquired) => (acquired ? Effect.suspend(use) : Effect.interrupt),
      (acquired) =>
        acquired
          ? activityPermit.withPermit(
              Effect.sync(() => {
                activeCalls--;
              }),
            )
          : Effect.void,
    );
  const watch = (client: Client) =>
    client.awaitTermination.pipe(
      Effect.catch((cause) =>
        Ref.get(current).pipe(
          Effect.flatMap((active) =>
            active === client && !retiring.has(client)
              ? Deferred.fail(termination, cause).pipe(Effect.asVoid)
              : Effect.void,
          ),
        ),
      ),
      Effect.forkScoped,
    );
  yield* watch(initial);

  const raw: Client["raw"] = {
    ...initial.raw,
    request: (method, payload) =>
      useClient(() =>
        Ref.get(current).pipe(Effect.flatMap((active) => active.raw.request(method, payload))),
      ),
  };
  const client: Client = {
    raw,
    awaitTermination: Deferred.await(termination),
    request: (method, payload) =>
      useClient(() =>
        Ref.get(current).pipe(Effect.flatMap((active) => active.request(method, payload))),
      ),
    notify: (method, payload) =>
      useClient(() =>
        Ref.get(current).pipe(Effect.flatMap((active) => active.notify(method, payload))),
      ),
    handleServerNotification: (method, handler) => {
      const registration = (target: Client) =>
        target.handleServerNotification(method, (payload) =>
          useClient(() => handler(payload), target),
        );
      return useClient(() =>
        Ref.get(current).pipe(
          Effect.flatMap(registration),
          Effect.tap(() => Effect.sync(() => notificationRegistrations.push(registration))),
        ),
      );
    },
    handleServerRequest: (method, handler) => {
      const registration = (target: Client) =>
        target.handleServerRequest(method, (payload) => useClient(() => handler(payload), target));
      return useClient(() =>
        Ref.get(current).pipe(
          Effect.flatMap(registration),
          Effect.tap(() => Effect.sync(() => requestRegistrations.push(registration))),
        ),
      );
    },
    handleUnknownServerRequest: (handler) => {
      const registration = (target: Client) =>
        target.handleUnknownServerRequest((method, params) =>
          useClient(() => handler(method, params), target),
        );
      return useClient(() =>
        Ref.get(current).pipe(
          Effect.flatMap(registration),
          Effect.tap(() => Effect.sync(() => unknownRequestRegistrations.push(registration))),
        ),
      );
    },
    handleUnknownServerNotification: (handler) => {
      const registration = (target: Client) =>
        target.handleUnknownServerNotification((method, params) =>
          useClient(() => handler(method, params), target),
        );
      return useClient(() =>
        Ref.get(current).pipe(
          Effect.flatMap(registration),
          Effect.tap(() => Effect.sync(() => unknownNotificationRegistrations.push(registration))),
        ),
      );
    },
  };

  return {
    client,
    withIdle: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      activityPermit.withPermit(
        Effect.suspend<A, E | CodexAixRotationError, R>(() =>
          activeCalls === 0
            ? effect
            : Effect.fail(new CodexAixRotationError({ reason: "active-work" })),
        ),
      ),
    prepare: Effect.fn("CodexAixClientProxy.prepare")(function* (next: Client) {
      for (const registrations of [
        notificationRegistrations,
        requestRegistrations,
        unknownRequestRegistrations,
        unknownNotificationRegistrations,
      ]) {
        for (const register of registrations) yield* register(next);
      }
    }),
    activate: Effect.fn("CodexAixClientProxy.activate")(function* (next: Client) {
      yield* Ref.set(current, next);
      yield* watch(next);
    }),
    markRetiring: (target: Client) => Effect.sync(() => retiring.add(target)),
    current: Ref.get(current),
  };
});

interface ReplaceableClient {
  readonly current: Effect.Effect<Client>;
  readonly withIdle: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | CodexAixRotationError, R>;
  readonly prepare: (client: Client) => Effect.Effect<void>;
  readonly activate: (client: Client) => Effect.Effect<void, never, Scope.Scope>;
  readonly markRetiring: (client: Client) => Effect.Effect<unknown>;
}

/** Owns the process replacement sequence while the adapter supplies its thread-local safety hooks. */
export const makeCodexAixClientRotation = (input: {
  readonly scope: Scope.Scope;
  readonly getClientScope: () => Scope.Closeable | undefined;
  readonly setClientScope: (scope: Scope.Closeable) => void;
  readonly terminalizationPermit: Semaphore.Semaphore;
  readonly client: ReplaceableClient;
  readonly getLaunch: () => CodexAixLaunch | undefined;
  readonly setLaunch: (launch: CodexAixLaunch) => void;
  readonly resolveLaunch: () => Effect.Effect<CodexAixLaunch, Error>;
  readonly hasUnsafeWork: Effect.Effect<boolean>;
  readonly openClient: (launch: CodexAixLaunch) => Effect.Effect<Client, Error, Scope.Scope>;
  readonly initialize: (client: Client) => Effect.Effect<void, CodexAixRotationError>;
  readonly onActivate: () => void;
  readonly resume: (
    turn: ProviderAdapter.ProviderAdapterV2TurnInput,
  ) => Effect.Effect<void, CodexAixRotationError>;
}) =>
  Effect.fn("CodexAixClientProxy.rotateForTurn")(function* (
    turn: ProviderAdapter.ProviderAdapterV2TurnInput,
  ): Effect.fn.Return<void, CodexAixRotationError, never> {
    const activeLaunch = input.getLaunch();
    if (activeLaunch === undefined) return;
    const refreshed = yield* input
      .resolveLaunch()
      .pipe(Effect.mapError(() => new CodexAixRotationError({ reason: "restart-failed" })));
    if (
      activeLaunch.environment.T3_AIX_API_KEY === refreshed.environment.T3_AIX_API_KEY &&
      activeLaunch.configArgs.join("\0") === refreshed.configArgs.join("\0")
    ) {
      return;
    }
    if (yield* input.hasUnsafeWork) {
      return yield* new CodexAixRotationError({ reason: "active-work" });
    }

    const nextScope = yield* Scope.fork(input.scope);
    const currentClient = yield* input.client.current;
    const nextClient = yield* input.openClient(refreshed).pipe(
      Effect.provideService(Scope.Scope, nextScope),
      Effect.mapError(() => new CodexAixRotationError({ reason: "restart-failed" })),
      Effect.onError(() => Scope.close(nextScope, Exit.void).pipe(Effect.ignore)),
    );
    yield* input.client.prepare(nextClient).pipe(
      Effect.andThen(input.initialize(nextClient)),
      Effect.mapError(() => new CodexAixRotationError({ reason: "restart-failed" })),
      Effect.onError(() => Scope.close(nextScope, Exit.void).pipe(Effect.ignore)),
    );
    const previousScope = input.getClientScope();
    yield* input.terminalizationPermit
      .withPermits(1)(
        input.client.withIdle(
          Effect.gen(function* () {
            if (yield* input.hasUnsafeWork) {
              return yield* new CodexAixRotationError({ reason: "active-work" });
            }
            yield* input.client.markRetiring(currentClient);
            input.setClientScope(nextScope);
            input.setLaunch(refreshed);
            input.onActivate();
            yield* input.client
              .activate(nextClient)
              .pipe(Effect.provideService(Scope.Scope, input.scope));
          }).pipe(Effect.uninterruptible),
        ),
      )
      .pipe(
        Effect.onError(() =>
          input.getClientScope() === nextScope
            ? Effect.void
            : Scope.close(nextScope, Exit.void).pipe(Effect.ignore),
        ),
        Effect.ensuring(
          Effect.suspend(() =>
            input.getClientScope() === nextScope && previousScope !== undefined
              ? Scope.close(previousScope, Exit.void)
              : Effect.void,
          ),
        ),
      );

    yield* input.resume(turn);
  });

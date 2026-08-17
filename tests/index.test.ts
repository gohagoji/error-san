/**
 * Runtime conformance tests for the public error-san API.
 *
 * These tests exercise only exported values and behavior observable through
 * wrapped functions and their results.
 */

import { expect, test, vi } from "vitest";

import {
  type Errors,
  UnexpectedError,
  wrapAsync,
  wrapSync,
} from "../src/index.js";

/** A manually controlled promise used to order concurrent invocations. */
type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value | PromiseLike<Value>) => void;
};

/** Creates a promise together with the functions that settle it. */
function createDeferred<Value>(): Deferred<Value> {
  let resolve!: Deferred<Value>["resolve"];

  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

/** Runs an operation and returns the exact value that it throws. */
function captureThrown(operation: () => unknown): unknown {
  try {
    operation();
  } catch (thrownValue) {
    return thrownValue;
  }

  throw new Error("Expected the operation to throw");
}

/**
 * Checks the public shape shared by success and failure results.
 *
 * Only the supplied mutable data fields may be own properties. Operations
 * must be shared, non-enumerable prototype methods.
 */
function expectMutableResultShape(
  result: object,
  expectedFields: Readonly<Record<string, unknown>>,
): void {
  expect(Object.isFrozen(result)).toBe(false);
  expect(Object.isExtensible(result)).toBe(true);
  expect(Object.keys(result)).toEqual(Object.keys(expectedFields));
  expect(Reflect.ownKeys(result)).toEqual(Object.keys(expectedFields));
  expect({ ...result }).toEqual(expectedFields);
  expect(result).toEqual(expectedFields);

  for (const [key, value] of Object.entries(expectedFields)) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key);
    if (descriptor === undefined) {
      throw new Error(`Missing result field descriptor for ${key}`);
    }

    expect(descriptor.value).toBe(value);
    expect(descriptor.enumerable).toBe(true);
    expect(descriptor.writable).toBe(true);
    expect(descriptor.configurable).toBe(true);
  }

  for (const operation of ["unwrap", "handle"] as const) {
    expect(Object.getOwnPropertyDescriptor(result, operation)).toBeUndefined();

    let prototype: object | null = Object.getPrototypeOf(result);
    let descriptor: PropertyDescriptor | undefined;

    while (prototype !== null && descriptor === undefined) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, operation);
      prototype = Object.getPrototypeOf(prototype);
    }

    if (descriptor === undefined) {
      throw new Error(`Missing result prototype operation ${operation}`);
    }

    expect(typeof descriptor.value).toBe("function");
    expect(descriptor.enumerable).toBe(false);
    expect(descriptor.writable).toBe(true);
    expect(descriptor.configurable).toBe(true);
  }
}

/** Checks the observable fields of the private declared-error instance. */
function expectDeclaredError(
  thrownValue: unknown,
  code: string,
  reason: unknown,
): asserts thrownValue is Error & {
  readonly code: string;
  readonly reason: unknown;
} {
  expect(thrownValue).toBeInstanceOf(Error);
  expect(thrownValue).not.toBeInstanceOf(UnexpectedError);

  if (!(thrownValue instanceof Error)) {
    throw new Error("Expected a declared error instance");
  }

  expect(thrownValue.name).toBe(code);
  expect(thrownValue).toMatchObject({ code });
  expect(Reflect.get(thrownValue, "reason")).toBe(reason);
}

type PayloadReason = { readonly message: string };

/** The public contract's exact no-reason type. */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` and `undefined` produce deliberately different raiser signatures.
type NoReason = void;

/** A context for an implementation with no declared error codes. */
// biome-ignore lint/complexity/noBannedTypes: Draft v0.12 explicitly spells the empty error map as Errors<{}>.
type NoErrors = Errors<{}>;

class FirstLevelUnexpectedError extends UnexpectedError {}

class SecondLevelUnexpectedError extends FirstLevelUnexpectedError {}

class ThirdLevelUnexpectedError extends SecondLevelUnexpectedError {}

class FourthLevelUnexpectedError extends ThirdLevelUnexpectedError {}

class ShadowedCodeUnexpectedError extends UnexpectedError {
  constructor(reason: unknown) {
    super(reason);
    Reflect.set(this, "code", "PayloadError");
  }
}

class StructuralUnexpectedError extends Error {
  readonly code = "UnexpectedError" as const;
  readonly reason: unknown;
  override readonly cause: unknown;

  constructor(reason: unknown) {
    super("UnexpectedError");
    this.name = "UnexpectedError";
    this.reason = reason;
    this.cause = reason;
  }
}

/** Raises the shared declared failure used by result-operation tests. */
const raisePayloadError = wrapSync(function raisePayload(
  errors: Errors<{ PayloadError: PayloadReason }>,
  reason: PayloadReason,
): never {
  return errors.PayloadError(reason);
});

test("exports exactly the documented runtime values", async () => {
  const api = await import("../src/index.js");

  expect(Object.keys(api).sort()).toEqual([
    "UnexpectedError",
    "wrapAsync",
    "wrapSync",
  ]);
  expect(api.UnexpectedError).toBe(UnexpectedError);
  expect(api.wrapAsync).toBe(wrapAsync);
  expect(api.wrapSync).toBe(wrapSync);
  expect(typeof api.wrapAsync.try).toBe("function");
  expect(typeof api.wrapSync.try).toBe("function");
});

test("wrappers remove the context, forward arguments, and not the receiver", () => {
  let observedThis: unknown = "not called";
  const add = wrapSync(function addValues(
    this: unknown,
    _errors: NoErrors,
    left: number,
    right: number,
  ): number {
    observedThis = this;
    return left + right;
  });

  const result = Reflect.apply(add, { applicationReceiver: true }, [20, 22]);
  if (!result.isOk) throw new Error("Expected the ordinary call to succeed");

  expect(result.data).toBe(42);
  expect(observedThis).toBeUndefined();
});

test("try shorthands preserve function arguments without forwarding the receiver", async () => {
  let syncThis: unknown = "not called";
  const join = wrapSync.try(function joinValues(
    this: unknown,
    left: string,
    right?: string,
  ): string {
    syncThis = this;
    return left + (right ?? "");
  });

  const syncResult = Reflect.apply(join, { applicationReceiver: true }, [
    "error",
    "-san",
  ]);
  if (!syncResult.isOk) throw new Error("Expected a sync success result");

  expect(syncResult.data).toBe("error-san");
  expect(syncThis).toBeUndefined();

  const stringifyResult = wrapSync.try(JSON.stringify)({ ready: true });
  if (!stringifyResult.isOk) {
    throw new Error("Expected JSON.stringify to succeed");
  }
  expect(stringifyResult.data).toBe('{"ready":true}');

  let asyncThis: unknown = "not called";
  const add = wrapAsync.try(function addValues(
    this: unknown,
    left: number,
    right: number,
  ): Promise<number> {
    asyncThis = this;
    return Promise.resolve(left + right);
  });

  const asyncResult = await Reflect.apply(
    add,
    { applicationReceiver: true },
    [20, 22],
  );
  if (!asyncResult.isOk) throw new Error("Expected an async success result");

  expect(asyncResult.data).toBe(42);
  expect(asyncThis).toBeUndefined();
});

test("try shorthands convert throws and rejections to unexpected failures", async () => {
  const syncThrown = { phase: "sync" };
  const syncResult = wrapSync.try(() => {
    throw syncThrown;
  })();

  if (syncResult.isOk) throw new Error("Expected a sync failure result");

  expect(syncResult.code).toBe("UnexpectedError");
  expect(syncResult.reason).toBe(syncThrown);

  const asyncSyncThrown = { phase: "async invocation" };
  const asyncSyncPromise = wrapAsync.try(() => {
    throw asyncSyncThrown;
  })();

  expect(asyncSyncPromise).toBeInstanceOf(Promise);

  const asyncSyncResult = await asyncSyncPromise;
  if (asyncSyncResult.isOk) {
    throw new Error("Expected an async invocation failure result");
  }

  expect(asyncSyncResult.code).toBe("UnexpectedError");
  expect(asyncSyncResult.reason).toBe(asyncSyncThrown);

  const asyncThrown = { phase: "async" };
  const asyncResult = await wrapAsync.try(() => Promise.reject(asyncThrown))();

  if (asyncResult.isOk) throw new Error("Expected an async failure result");

  expect(asyncResult.code).toBe("UnexpectedError");
  expect(asyncResult.reason).toBe(asyncThrown);

  const retained = new UnexpectedError({ source: "existing" });
  const retainedResult = wrapSync.try(() => {
    throw retained;
  })();

  expect(captureThrown(() => retainedResult.unwrap())).toBe(retained);
});

test("try shorthands preserve the wrappers' distinct thenable behavior", async () => {
  const thenGetterError = new Error("sync try must not inspect then");
  let thenReads = 0;
  const hostileThenable = Object.defineProperty(
    { marker: "hostile thenable" },
    // biome-ignore lint/suspicious/noThenProperty: The test deliberately uses a throwing `then` getter.
    "then",
    {
      get() {
        thenReads += 1;
        throw thenGetterError;
      },
    },
  );

  const syncResult = wrapSync.try(() => hostileThenable)();
  if (!syncResult.isOk) throw new Error("Expected a sync success result");

  expect(syncResult.data).toBe(hostileThenable);
  expect(thenReads).toBe(0);

  const finalValue = { id: "assimilated" };
  const thenable = {
    // biome-ignore lint/suspicious/noThenProperty: Assimilation is the behavior under test.
    then(resolve: (value: typeof finalValue) => void): void {
      resolve(finalValue);
    },
  };
  const asyncResult = await wrapAsync.try(() => thenable)();
  if (!asyncResult.isOk) throw new Error("Expected an async success result");

  expect(asyncResult.data).toBe(finalValue);
});

test("collision-prone string codes work", () => {
  const raiseCollision = wrapSync(
    (
      errors: Errors<{
        __proto__: string;
        constructor: string;
        toString: string;
      }>,
      code: "__proto__" | "constructor" | "toString",
    ): never => {
      const raise = Reflect.get(errors, code) as (reason: string) => never;
      return raise(code);
    },
  );

  for (const code of ["__proto__", "constructor", "toString"] as const) {
    const result = raiseCollision(code);
    if (result.isOk) throw new Error(`Expected ${code} to fail`);

    expect(result.code).toBe(code);
    expect(result.reason).toBe(code);
  }
});

test("UnexpectedError retains an arbitrary reason as its own cause", () => {
  const reason = { source: "database", retryable: false };
  const error = new UnexpectedError(reason);

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("UnexpectedError");
  expect(error.message).toBe("UnexpectedError");
  expect(error.code).toBe("UnexpectedError");
  expect(error.reason).toBe(reason);
  expect(error.cause).toBe(reason);
  expect(Object.getOwnPropertyDescriptor(error, "cause")).toBeDefined();
});

test("every injected context can raise a retained UnexpectedError", () => {
  const reason = { source: "explicit universal raiser" };
  let caughtInsideInvocation: unknown;

  const raiseUnexpected = wrapSync(function raiseExplicitUnexpected(
    errors: Errors<{ DeclaredError: NoReason }>,
  ): never {
    try {
      return errors.UnexpectedError(reason);
    } catch (thrownValue) {
      caughtInsideInvocation = thrownValue;
      throw thrownValue;
    }
  });

  const result = raiseUnexpected();
  if (result.isOk) throw new Error("Expected an unexpected failure result");

  const retainedError = result.unwrap((error) => error);
  expect(retainedError).toBeInstanceOf(UnexpectedError);
  expect(retainedError).toBe(caughtInsideInvocation);
  expect(retainedError.reason).toBe(reason);
  expect(retainedError.cause).toBe(reason);
  expect(retainedError.stack).toContain("raiseExplicitUnexpected");
  expect(result.code).toBe("UnexpectedError");
  expect(result.reason).toBe(reason);
  expect(captureThrown(() => result.unwrap())).toBe(retainedError);

  const noReasonResult = wrapSync((errors: NoErrors): never =>
    errors.UnexpectedError(),
  )();
  if (noReasonResult.isOk) {
    throw new Error("Expected a no-reason unexpected failure");
  }

  const noReasonError = noReasonResult.unwrap((error) => error);
  expect(noReasonError).toBeInstanceOf(UnexpectedError);
  expect(noReasonError.reason).toBeUndefined();
  expect(noReasonError.cause).toBeUndefined();
  expect(captureThrown(() => noReasonResult.unwrap())).toBe(noReasonError);
});

test("detached UnexpectedError raisers do not depend on invocation provenance", () => {
  type UniversalRaiser = (reason?: unknown) => never;

  let detachedRaiser: UniversalRaiser | undefined;
  const captureResult = wrapSync((errors: NoErrors): string => {
    detachedRaiser = errors.UnexpectedError;
    return "captured";
  })();

  if (!captureResult.isOk)
    throw new Error("Expected raiser capture to succeed");
  if (detachedRaiser === undefined) throw new Error("Raiser was not captured");
  const raiseDetached = detachedRaiser;

  const reason = { source: "detached universal raiser" };
  let caughtAcrossInvocation: unknown;
  const detachedResult = wrapSync(function invokeDetachedUnexpected(
    _errors: NoErrors,
  ): never {
    try {
      return raiseDetached(reason);
    } catch (thrownValue) {
      caughtAcrossInvocation = thrownValue;
      throw thrownValue;
    }
  })();

  if (detachedResult.isOk) {
    throw new Error("Expected the detached raiser to fail");
  }

  const retainedError = detachedResult.unwrap((error) => error);
  expect(retainedError).toBeInstanceOf(UnexpectedError);
  expect(retainedError).toBe(caughtAcrossInvocation);
  expect(retainedError.reason).toBe(reason);

  const outerResult = wrapSync((_errors: NoErrors) =>
    detachedResult.unwrap(),
  )();
  if (outerResult.isOk) throw new Error("Expected the outer wrapper to fail");

  expect(outerResult.reason).toBe(reason);
  expect(outerResult.unwrap((error) => error)).toBe(retainedError);
  expect(captureThrown(() => outerResult.unwrap())).toBe(retainedError);
});

test("UnexpectedError subclasses retain identity through arbitrary-depth lineage", () => {
  const reason = { source: "extended unexpected error" };
  const unexpectedError = new FourthLevelUnexpectedError(reason);
  const result = wrapSync((_errors: NoErrors) => {
    throw unexpectedError;
  })();

  expect(unexpectedError).toBeInstanceOf(UnexpectedError);
  if (result.isOk) throw new Error("Expected a subclass failure result");

  expect(result.code).toBe("UnexpectedError");
  expect(result.reason).toBe(reason);
  expect(result.unwrap((error) => error)).toBe(unexpectedError);
  expect(captureThrown(() => result.unwrap())).toBe(unexpectedError);
  expect(
    captureThrown(() =>
      result.unwrap({ UnexpectedError: FourthLevelUnexpectedError }),
    ),
  ).toBe(unexpectedError);
  expect(
    captureThrown(() =>
      result.handle({ UnexpectedError: FourthLevelUnexpectedError }),
    ),
  ).toBe(unexpectedError);

  const outerResult = wrapSync((_errors: NoErrors) => result.unwrap())();
  if (outerResult.isOk) throw new Error("Expected an outer subclass failure");

  expect(outerResult.reason).toBe(reason);
  expect(captureThrown(() => outerResult.unwrap())).toBe(unexpectedError);
});

test("unexpected failure results pin their code independently of the retained instance", () => {
  const reason = { source: "shadowed subclass code" };
  const unexpectedError = new ShadowedCodeUnexpectedError(reason);
  const result = wrapSync((_errors: NoErrors) => {
    throw unexpectedError;
  })();

  expect(Reflect.get(unexpectedError, "code")).toBe("PayloadError");
  if (result.isOk) throw new Error("Expected an unexpected failure result");

  expectMutableResultShape(result, {
    isOk: false,
    code: "UnexpectedError",
    reason,
  });
  expect(result.unwrap((error) => error)).toBe(unexpectedError);
  expect(
    result.unwrap({ UnexpectedError: (receivedReason) => receivedReason }),
  ).toBe(reason);
  expect(captureThrown(() => result.unwrap())).toBe(unexpectedError);

  const forgedError = Object.create(
    UnexpectedError.prototype,
  ) as UnexpectedError;
  const forgedResult = wrapSync((_errors: NoErrors) => {
    throw forgedError;
  })();

  if (forgedResult.isOk) throw new Error("Expected a forged failure result");

  expect(forgedResult.code).toBe("UnexpectedError");
  expect(forgedResult.reason).toBeUndefined();
  expect(captureThrown(() => forgedResult.unwrap())).toBe(forgedError);
});

test("wrapSync preserves required, optional, and absent declared reasons", () => {
  type ReasonKind =
    | "absent"
    | "explicit-undefined"
    | "optional-absent"
    | "optional-value"
    | "required";

  const run = wrapSync(
    (
      errors: Errors<{
        ExplicitUndefinedError: undefined;
        NoReasonError: NoReason;
        OptionalReasonError: string | NoReason;
        RequiredReasonError: PayloadReason;
      }>,
      kind: ReasonKind,
    ): never => {
      if (kind === "absent") errors.NoReasonError();
      if (kind === "explicit-undefined")
        errors.ExplicitUndefinedError(undefined);
      if (kind === "optional-absent") errors.OptionalReasonError();
      if (kind === "optional-value")
        errors.OptionalReasonError("optional reason");
      return errors.RequiredReasonError({ message: "required reason" });
    },
  );
  const absent = run("absent");
  const explicitUndefined = run("explicit-undefined");
  const optionalAbsent = run("optional-absent");
  const optionalValue = run("optional-value");
  const required = run("required");

  expect(absent).toEqual({
    isOk: false,
    code: "NoReasonError",
    reason: undefined,
  });
  expect(explicitUndefined).toEqual({
    isOk: false,
    code: "ExplicitUndefinedError",
    reason: undefined,
  });
  expect(optionalAbsent).toEqual({
    isOk: false,
    code: "OptionalReasonError",
    reason: undefined,
  });
  expect(optionalValue).toEqual({
    isOk: false,
    code: "OptionalReasonError",
    reason: "optional reason",
  });
  expect(required).toEqual({
    isOk: false,
    code: "RequiredReasonError",
    reason: { message: "required reason" },
  });
});

test("wrapSync normalizes arbitrary thrown values including null and undefined", () => {
  const thrownValues = [
    null,
    undefined,
    "plain string",
    { marker: "object" },
  ] as const;

  for (const thrownValue of thrownValues) {
    const result = wrapSync((_errors: NoErrors) => {
      throw thrownValue;
    })();

    if (result.isOk) throw new Error("Expected a failure result");

    expect(result.code).toBe("UnexpectedError");
    expect(result.reason).toBe(thrownValue);

    const unwrapped = captureThrown(() => result.unwrap());
    if (!(unwrapped instanceof UnexpectedError)) {
      throw new Error("Expected bare unwrap to throw UnexpectedError");
    }

    expect(unwrapped.reason).toBe(thrownValue);
    expect(unwrapped.cause).toBe(thrownValue);
  }
});

test("wrapSync classifies thrown values that defeat prototype inspection", () => {
  const trapError = new Error("prototype trap must not escape");
  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw trapError;
      },
    },
  );

  const hostileResult = wrapSync((_errors: NoErrors) => {
    throw hostileProxy;
  })();

  if (hostileResult.isOk) throw new Error("Expected a failure result");

  expect(hostileResult.code).toBe("UnexpectedError");
  expect(hostileResult.reason).toBe(hostileProxy);

  const { proxy: revokedProxy, revoke } = Proxy.revocable({}, {});
  revoke();

  const revokedResult = wrapSync((_errors: NoErrors) => {
    throw revokedProxy;
  })();

  if (revokedResult.isOk) throw new Error("Expected a failure result");

  expect(revokedResult.code).toBe("UnexpectedError");
  expect(revokedResult.reason).toBe(revokedProxy);
});

test("wrapSync preserves promises and hostile thenables as exact data", async () => {
  const rejection = new Error("later rejection");
  const promise = Promise.reject(rejection);
  const promiseResult = wrapSync((_errors: NoErrors) => promise)();

  if (!promiseResult.isOk) throw new Error("Expected a success result");

  expect(promiseResult.data).toBe(promise);
  await expect(promise).rejects.toBe(rejection);

  const thenGetterError = new Error("then getter must not run");
  let thenReads = 0;
  const hostileThenable = Object.defineProperty(
    { marker: "hostile thenable" },
    // biome-ignore lint/suspicious/noThenProperty: The test deliberately uses a throwing `then` getter.
    "then",
    {
      get() {
        thenReads += 1;
        throw thenGetterError;
      },
    },
  );

  const thenableResult = wrapSync((_errors: NoErrors) => hostileThenable)();

  if (!thenableResult.isOk) throw new Error("Expected a success result");

  expect(thenableResult.data).toBe(hostileThenable);
  expect(thenReads).toBe(0);
});

test("wrapAsync invokes immediately and turns a synchronous throw into a promise", async () => {
  const thrownValue = { phase: "invocation" };
  let invoked = false;

  const resultPromise = wrapAsync((_errors: NoErrors) => {
    invoked = true;
    throw thrownValue;
  })();

  expect(invoked).toBe(true);
  expect(resultPromise).toBeInstanceOf(Promise);

  const result = await resultPromise;
  if (result.isOk) throw new Error("Expected a failure result");

  expect(result.code).toBe("UnexpectedError");
  expect(result.reason).toBe(thrownValue);
});

test("wrapAsync recursively assimilates native promises and custom thenables", async () => {
  const finalValue = { id: "resolved" };
  let outerCalls = 0;
  let innerCalls = 0;

  const innerThenable = {
    // biome-ignore lint/suspicious/noThenProperty: Recursive thenable assimilation is the behavior under test.
    then(resolve: (value: typeof finalValue) => void): void {
      innerCalls += 1;
      resolve(finalValue);
    },
  };
  const outerThenable = {
    // biome-ignore lint/suspicious/noThenProperty: Recursive thenable assimilation is the behavior under test.
    then(resolve: (value: typeof innerThenable) => void): void {
      outerCalls += 1;
      resolve(innerThenable);
    },
  };

  const plainResult = await wrapAsync((_errors: NoErrors) => finalValue)();
  const promiseResult = await wrapAsync((_errors: NoErrors) =>
    Promise.resolve(finalValue),
  )();
  const thenableResult = await wrapAsync(
    (_errors: NoErrors) => outerThenable,
  )();

  if (!plainResult.isOk) throw new Error("Expected a plain success result");
  if (!promiseResult.isOk) throw new Error("Expected a promise success result");
  if (!thenableResult.isOk)
    throw new Error("Expected a thenable success result");

  expect(plainResult.data).toBe(finalValue);
  expect(promiseResult.data).toBe(finalValue);
  expect(thenableResult.data).toBe(finalValue);
  expect(outerCalls).toBe(1);
  expect(innerCalls).toBe(1);
});

test("wrapAsync converts rejections and post-await raiser throws", async () => {
  const rejection = { source: "rejection" };
  const rejectedResult = await wrapAsync((_errors: NoErrors) =>
    Promise.reject(rejection),
  )();

  if (rejectedResult.isOk) throw new Error("Expected a rejection result");

  expect(rejectedResult.code).toBe("UnexpectedError");
  expect(rejectedResult.reason).toBe(rejection);

  const declaredReason = { message: "raised after await" };

  const raiseAfterAwait = wrapAsync(
    async (errors: Errors<{ AsyncError: PayloadReason }>): Promise<never> => {
      await Promise.resolve();
      return errors.AsyncError(declaredReason);
    },
  );

  const declaredResult = await raiseAfterAwait();

  if (declaredResult.isOk)
    throw new Error("Expected a declared failure result");

  expect(declaredResult.code).toBe("AsyncError");
  expect(declaredResult.reason).toBe(declaredReason);

  const unexpectedReason = { source: "universal raiser after await" };
  let caughtUnexpected: unknown;
  const unexpectedResult = await wrapAsync(async function raiseAfterAwait(
    errors: NoErrors,
  ): Promise<never> {
    await Promise.resolve();

    try {
      return errors.UnexpectedError(unexpectedReason);
    } catch (thrownValue) {
      caughtUnexpected = thrownValue;
      throw thrownValue;
    }
  })();

  if (unexpectedResult.isOk) {
    throw new Error("Expected an unexpected failure result");
  }

  const retainedUnexpected = unexpectedResult.unwrap((error) => error);
  expect(retainedUnexpected).toBeInstanceOf(UnexpectedError);
  expect(retainedUnexpected).toBe(caughtUnexpected);
  expect(retainedUnexpected.reason).toBe(unexpectedReason);
  expect(unexpectedResult.code).toBe("UnexpectedError");
  expect(unexpectedResult.reason).toBe(unexpectedReason);
});

test("wrapAsync classifies a declared raise thrown before any asynchronous work", async () => {
  const reason = { message: "raised synchronously" };

  const raiseBeforeAsyncWork = wrapAsync(
    (errors: Errors<{ EarlyError: PayloadReason }>): Promise<string> =>
      errors.EarlyError(reason),
  );

  const resultPromise = raiseBeforeAsyncWork();

  expect(resultPromise).toBeInstanceOf(Promise);

  const result = await resultPromise;
  if (result.isOk) throw new Error("Expected a declared failure result");

  expect(result.code).toBe("EarlyError");
  expect(result.reason).toBe(reason);
});

test("wrapAsync converts a throwing then getter into an unexpected failure", async () => {
  const thenGetterError = new Error("cannot inspect then");
  let thenReads = 0;
  const hostileThenable = Object.defineProperty(
    { marker: "hostile thenable" },
    // biome-ignore lint/suspicious/noThenProperty: The test deliberately uses a throwing `then` getter.
    "then",
    {
      get() {
        thenReads += 1;
        throw thenGetterError;
      },
    },
  );

  const result = await wrapAsync((_errors: NoErrors) => hostileThenable)();

  if (result.isOk) throw new Error("Expected a failure result");

  expect(thenReads).toBe(1);
  expect(result.code).toBe("UnexpectedError");
  expect(result.reason).toBe(thenGetterError);
});

test("wrapAsync stays promise-shaped when classifying hostile thrown values", async () => {
  const hostileProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("prototype trap must not escape");
      },
    },
  );

  const syncThrowPromise = wrapAsync((_errors: NoErrors) => {
    throw hostileProxy;
  })();

  expect(syncThrowPromise).toBeInstanceOf(Promise);

  const syncThrowResult = await syncThrowPromise;
  if (syncThrowResult.isOk) throw new Error("Expected a failure result");

  expect(syncThrowResult.code).toBe("UnexpectedError");
  expect(syncThrowResult.reason).toBe(hostileProxy);

  const rejectionResult = await wrapAsync((_errors: NoErrors) =>
    Promise.reject(hostileProxy),
  )();

  if (rejectionResult.isOk) throw new Error("Expected a failure result");

  expect(rejectionResult.code).toBe("UnexpectedError");
  expect(rejectionResult.reason).toBe(hostileProxy);
});

test("results are mutable data-shaped objects with shared hidden operations", () => {
  const data = { id: "42", name: "Ada" };
  const success = wrapSync((_errors: NoErrors) => data)();
  const otherSuccess = wrapSync((_errors: NoErrors) => null)();
  const reason = { message: "not found" };
  const failure = raisePayloadError(reason);
  const otherFailure = raisePayloadError({ message: "also not found" });

  expectMutableResultShape(success, { isOk: true, data });
  expectMutableResultShape(failure, {
    isOk: false,
    code: "PayloadError",
    reason,
  });
  expect(success.unwrap).toBe(otherSuccess.unwrap);
  expect(success.handle).toBe(otherSuccess.handle);
  expect(failure.unwrap).toBe(otherFailure.unwrap);
  expect(failure.handle).toBe(otherFailure.handle);

  expect(JSON.stringify(success)).toBe(
    '{"isOk":true,"data":{"id":"42","name":"Ada"}}',
  );
  expect(JSON.stringify(failure)).toBe(
    '{"isOk":false,"code":"PayloadError","reason":{"message":"not found"}}',
  );

  const clonedSuccess = structuredClone(success);
  const clonedFailure = structuredClone(failure);

  expect(clonedSuccess).toEqual({ isOk: true, data });
  expect(clonedFailure).toEqual({
    isOk: false,
    code: "PayloadError",
    reason,
  });
  expect(
    Object.getOwnPropertyDescriptor(clonedSuccess, "unwrap"),
  ).toBeUndefined();
  expect(
    Object.getOwnPropertyDescriptor(clonedFailure, "handle"),
  ).toBeUndefined();

  const replacementData = { id: "43", name: "Grace" };
  const replacementReason = { message: "moved" };
  const retainedFailure = failure.unwrap((error) => error);

  if (!success.isOk || failure.isOk) {
    throw new Error("Expected one success and one failure");
  }

  success.data = replacementData;
  failure.reason = replacementReason;

  expect(success.unwrap()).toBe(replacementData);
  expect(
    failure.unwrap({
      PayloadError: (receivedReason) => receivedReason,
      UnexpectedError,
    }),
  ).toBe(replacementReason);
  expect(failure.unwrap((error) => error)).toBe(retainedFailure);
  expect(Reflect.set(success, "isOk", false)).toBe(true);

  const replacementUnwrap = () => null;
  expect(Reflect.set(otherSuccess, "unwrap", replacementUnwrap)).toBe(true);
  expect(otherSuccess.unwrap).toBe(replacementUnwrap);
});

test("success unwrap returns data without invoking either handler form", () => {
  const data = { status: "ready" };
  const result = wrapSync((_errors: NoErrors) => data)();
  const catchAll = vi.fn(() => "fallback");
  const unexpectedHandler = vi.fn(() => "fallback");

  expect(result.unwrap()).toBe(data);
  expect(result.unwrap(catchAll)).toBe(data);
  expect(result.unwrap({ UnexpectedError: unexpectedHandler })).toBe(data);
  expect(catchAll).not.toHaveBeenCalled();
  expect(unexpectedHandler).not.toHaveBeenCalled();
});

test("declared unwrap retains the private error and supports map and sentinel forms", () => {
  const reason = { message: "invalid input" };
  const result = raisePayloadError(reason);
  const retainedError = result.unwrap((error) => error);

  expectDeclaredError(retainedError, "PayloadError", reason);
  expect(retainedError.stack).toContain("raisePayload");

  const mapped = result.unwrap({
    PayloadError: (receivedReason) => {
      expect(receivedReason).toBe(reason);
      return "recovered" as const;
    },
    UnexpectedError,
  });
  expect(mapped).toBe("recovered");

  const bareError = captureThrown(() => result.unwrap());
  if (!(bareError instanceof UnexpectedError)) {
    throw new Error("Expected bare unwrap to throw UnexpectedError");
  }
  expect(bareError.reason).toBe(retainedError);
  expect(bareError.cause).toBe(retainedError);

  const sentinelError = captureThrown(() =>
    result.unwrap({
      PayloadError: UnexpectedError,
      UnexpectedError,
    }),
  );
  if (!(sentinelError instanceof UnexpectedError)) {
    throw new Error("Expected the sentinel to throw UnexpectedError");
  }
  expect(sentinelError.reason).toBe(retainedError);
  expect(sentinelError.cause).toBe(retainedError);
});

test("subclass sentinels construct declared failures with the retained error", () => {
  const reason = { message: "construct through subclass sentinel" };
  const result = raisePayloadError(reason);
  const retainedError = result.unwrap((error) => error);
  const unwrapError = captureThrown(() =>
    result.unwrap({
      PayloadError: FourthLevelUnexpectedError,
      UnexpectedError: FourthLevelUnexpectedError,
    }),
  );
  const handleError = captureThrown(() =>
    result.handle({ PayloadError: FourthLevelUnexpectedError }),
  );

  for (const normalizedError of [unwrapError, handleError]) {
    if (!(normalizedError instanceof FourthLevelUnexpectedError)) {
      throw new Error("Expected subclass sentinel normalization");
    }

    expect(normalizedError.constructor).toBe(FourthLevelUnexpectedError);
    expect(normalizedError.reason).toBe(retainedError);
    expect(normalizedError.cause).toBe(retainedError);
  }
});

test("subclass sentinels convert unexpected failures that are not instances of the selected constructor", () => {
  const reason = { source: "subclass sentinel conversion" };
  const unexpectedError = new UnexpectedError(reason);
  const result = wrapSync((_errors: NoErrors) => {
    throw unexpectedError;
  })();

  const unwrapError = captureThrown(() =>
    result.unwrap({ UnexpectedError: FourthLevelUnexpectedError }),
  );
  const handleError = captureThrown(() =>
    result.handle({ UnexpectedError: FourthLevelUnexpectedError }),
  );

  for (const convertedError of [unwrapError, handleError]) {
    if (!(convertedError instanceof FourthLevelUnexpectedError)) {
      throw new Error("Expected an extended unexpected error");
    }

    expect(convertedError).not.toBe(unexpectedError);
    expect(convertedError.reason).toBe(reason);
    expect(convertedError.cause).toBe(reason);
  }

  expect(captureThrown(() => result.unwrap({ UnexpectedError }))).toBe(
    unexpectedError,
  );
});

test("matching sentinels rethrow retained unexpected errors before reading their reason", () => {
  const unexpectedError = new FourthLevelUnexpectedError("original reason");
  const result = wrapSync((_errors: NoErrors) => {
    throw unexpectedError;
  })();
  const readReason = vi.fn(() => {
    throw new Error("The retained reason should not be read");
  });

  Object.defineProperty(unexpectedError, "reason", {
    configurable: true,
    enumerable: true,
    get: readReason,
  });

  expect(captureThrown(() => result.unwrap())).toBe(unexpectedError);
  expect(
    captureThrown(() =>
      result.unwrap({ UnexpectedError: FourthLevelUnexpectedError }),
    ),
  ).toBe(unexpectedError);
  expect(
    captureThrown(() =>
      result.handle({ UnexpectedError: FourthLevelUnexpectedError }),
    ),
  ).toBe(unexpectedError);
  expect(readReason).not.toHaveBeenCalled();
});

test("an existing UnexpectedError keeps its identity through result operations and boundaries", () => {
  const reason = { source: "foreign library" };
  const unexpectedError = new UnexpectedError(reason);
  const result = wrapSync((_errors: NoErrors) => {
    throw unexpectedError;
  })();

  if (result.isOk) throw new Error("Expected a failure result");

  expect(result.code).toBe("UnexpectedError");
  expect(result.reason).toBe(reason);
  expect(result.unwrap((error) => error)).toBe(unexpectedError);
  expect(
    result.unwrap({ UnexpectedError: (receivedReason) => receivedReason }),
  ).toBe(reason);
  expect(captureThrown(() => result.unwrap())).toBe(unexpectedError);
  expect(captureThrown(() => result.unwrap({ UnexpectedError }))).toBe(
    unexpectedError,
  );

  const outerResult = wrapSync((_errors: NoErrors) => result.unwrap())();
  if (outerResult.isOk) throw new Error("Expected an outer failure result");

  expect(outerResult.code).toBe("UnexpectedError");
  expect(outerResult.reason).toBe(reason);
  expect(captureThrown(() => outerResult.unwrap())).toBe(unexpectedError);
});

test("unwrap requires own handlers, rejects malformed maps, and never catches handler failures", () => {
  const reason = { message: "invalid input" };
  const result = raisePayloadError(reason);
  const runtimeUnwrap = (result.unwrap as (...args: unknown[]) => unknown).bind(
    result,
  );
  const inheritedHandler = vi.fn(() => "inherited");
  const inheritedMap = Object.create({ PayloadError: inheritedHandler });

  expect(() => runtimeUnwrap({})).toThrow(TypeError);
  expect(() => runtimeUnwrap(inheritedMap)).toThrow(TypeError);
  expect(inheritedHandler).not.toHaveBeenCalled();
  expect(() => runtimeUnwrap({ PayloadError: undefined })).toThrow(TypeError);
  expect(() => runtimeUnwrap({ PayloadError: null })).toThrow(TypeError);
  expect(() =>
    runtimeUnwrap({ PayloadError: StructuralUnexpectedError }),
  ).toThrow(TypeError);
  expect(() => runtimeUnwrap(null)).toThrow(TypeError);

  // An explicit undefined argument is a malformed map, not a bare unwrap.
  expect(() => runtimeUnwrap(undefined)).toThrow(TypeError);

  // Entries for codes other than the active one are never read or validated.
  const untouchedEntryReads = vi.fn(() => null);
  const lazyMap = Object.defineProperty(
    { PayloadError: () => "lazily validated" },
    "UnexpectedError",
    { enumerable: true, get: untouchedEntryReads },
  );

  expect(runtimeUnwrap(lazyMap)).toBe("lazily validated");
  expect(untouchedEntryReads).not.toHaveBeenCalled();

  // A callable argument selects the catch-all form despite handler properties.
  const retainedError = result.unwrap((error) => error);
  const handlerPropertyReads = vi.fn(() => null);
  const callableMap = Object.defineProperty(
    (error: unknown) => error,
    "PayloadError",
    { enumerable: true, get: handlerPropertyReads },
  );

  expect(runtimeUnwrap(callableMap)).toBe(retainedError);
  expect(handlerPropertyReads).not.toHaveBeenCalled();

  const mapHandlerError = new Error("map handler failed");
  const catchAllError = new Error("catch-all handler failed");

  expect(
    captureThrown(() =>
      result.unwrap({
        PayloadError: () => {
          throw mapHandlerError;
        },
        UnexpectedError,
      }),
    ),
  ).toBe(mapHandlerError);
  expect(
    captureThrown(() =>
      result.unwrap(() => {
        throw catchAllError;
      }),
    ),
  ).toBe(catchAllError);

  const promise = Promise.resolve("async recovery");
  const returned = result.unwrap({
    PayloadError: () => promise,
    UnexpectedError,
  });
  expect(returned).toBe(promise);
});

test("unwrap never treats Object.prototype functions as handlers", () => {
  const failure = wrapSync((errors: Errors<{ toString: string }>): never =>
    errors.toString("prototype collision"),
  )();
  const runtimeUnwrap = (failure.unwrap as (handlers: unknown) => unknown).bind(
    failure,
  );

  expect(() => runtimeUnwrap({})).toThrow(
    new TypeError("No callable unwrap handler for toString"),
  );
});

test("handle preserves success and unhandled identities and creates a mutable recovery", () => {
  const successData = { state: "ready" };
  const success = wrapSync((_errors: NoErrors) => successData)();
  const successHandler = vi.fn(() => "unused");

  expect(success.handle({ UnexpectedError: successHandler })).toBe(success);
  expect(success.handle({ UnexpectedError })).toBe(success);
  expect(successHandler).not.toHaveBeenCalled();

  const reason = { message: "recoverable" };
  const failure = raisePayloadError(reason);
  const unexpectedHandler = vi.fn(() => "unused");

  expect(failure.handle({})).toBe(failure);
  expect(failure.handle({ UnexpectedError: unexpectedHandler })).toBe(failure);
  expect(failure.handle({ UnexpectedError })).toBe(failure);
  expect(unexpectedHandler).not.toHaveBeenCalled();

  const recoveredData = { state: "recovered" };
  const payloadHandler = vi.fn((receivedReason: PayloadReason) => {
    expect(receivedReason).toBe(reason);
    return recoveredData;
  });
  const recovered = failure.handle({ PayloadError: payloadHandler });

  if (!recovered.isOk) throw new Error("Expected a recovered success result");

  expect(recovered.data).toBe(recoveredData);
  expect(payloadHandler).toHaveBeenCalledOnce();
  expectMutableResultShape(recovered, { isOk: true, data: recoveredData });
});

test("handle recovers an unexpected failure with its retained public reason", () => {
  const thrownValue = new Error("infrastructure failed");
  const failure = wrapSync((_errors: NoErrors) => {
    throw thrownValue;
  })();

  if (failure.isOk) throw new Error("Expected a failure result");

  const recovered = failure.handle({
    UnexpectedError: (reason) => {
      expect(reason).toBe(thrownValue);
      return "recovered fallback";
    },
  });

  expect(recovered.isOk).toBe(true);
  expect(recovered.data).toBe("recovered fallback");
  expectMutableResultShape(recovered, {
    isOk: true,
    data: "recovered fallback",
  });
});

test("handle sentinel normalizes declared failures and retains unexpected identity", () => {
  const reason = { message: "escalate declared failure" };
  const declaredFailure = raisePayloadError(reason);
  const retainedError = declaredFailure.unwrap((error) => error);
  const normalizedError = captureThrown(() =>
    declaredFailure.handle({ PayloadError: UnexpectedError }),
  );

  if (!(normalizedError instanceof UnexpectedError)) {
    throw new Error("Expected the handle sentinel to throw UnexpectedError");
  }

  expectDeclaredError(retainedError, "PayloadError", reason);
  expect(normalizedError.reason).toBe(retainedError);
  expect(normalizedError.cause).toBe(retainedError);

  const unexpectedError = new UnexpectedError({ source: "handle sentinel" });
  const unexpectedFailure = wrapSync((_errors: NoErrors) => {
    throw unexpectedError;
  })();

  expect(
    captureThrown(() => unexpectedFailure.handle({ UnexpectedError })),
  ).toBe(unexpectedError);
});

test("handle ignores undefined, rejects other invalid matches, and preserves handler output", () => {
  const reason = { message: "recoverable" };
  const failure = raisePayloadError(reason);
  const runtimeHandle = (failure.handle as (handlers: unknown) => unknown).bind(
    failure,
  );
  const inheritedHandler = vi.fn(() => "inherited");
  const inheritedMap = Object.create({ PayloadError: inheritedHandler });

  expect(runtimeHandle(inheritedMap)).toBe(failure);
  expect(inheritedHandler).not.toHaveBeenCalled();
  expect(runtimeHandle({ PayloadError: undefined })).toBe(failure);
  expect(() => runtimeHandle({ PayloadError: null })).toThrow(TypeError);
  expect(() =>
    runtimeHandle({ PayloadError: StructuralUnexpectedError }),
  ).toThrow(TypeError);

  // Entries for codes other than the active one are never read or validated.
  const untouchedEntryReads = vi.fn(() => null);
  const unhandledMap = Object.defineProperty({}, "UnexpectedError", {
    enumerable: true,
    get: untouchedEntryReads,
  });

  expect(runtimeHandle(unhandledMap)).toBe(failure);
  expect(untouchedEntryReads).not.toHaveBeenCalled();

  const handlerError = new Error("handler failed");
  expect(
    captureThrown(() =>
      failure.handle({
        PayloadError: () => {
          throw handlerError;
        },
      }),
    ),
  ).toBe(handlerError);

  let thenReads = 0;
  const hostileHandlerOutput = Object.defineProperty(
    { state: "returned" },
    // biome-ignore lint/suspicious/noThenProperty: Non-assimilation of handler output is the behavior under test.
    "then",
    {
      get() {
        thenReads += 1;
        throw new Error("handler output must not be assimilated");
      },
    },
  );
  const handled = failure.handle({
    PayloadError: () => hostileHandlerOutput,
  });

  if (!handled.isOk) throw new Error("Expected a handled success result");

  expect(handled.data).toBe(hostileHandlerOutput);
  expect(thenReads).toBe(0);
});

test("class prototype methods type-check but neither operation invokes them", () => {
  const reason = { message: "prototype methods" };
  const failure = raisePayloadError(reason);
  let unwrapCalls = 0;

  class ExhaustiveMethodHandlers {
    PayloadError(receivedReason: PayloadReason): string {
      unwrapCalls += 1;
      return `recovered:${receivedReason.message}`;
    }

    UnexpectedError(receivedReason: unknown): never {
      throw new Error(`unexpected: ${String(receivedReason)}`);
    }
  }

  // Structural typing cannot express own-ness, so this exhaustive map
  // type-checks even though its methods are inherited at runtime.
  expect(() => failure.unwrap(new ExhaustiveMethodHandlers())).toThrow(
    TypeError,
  );
  expect(unwrapCalls).toBe(0);

  class PartialMethodHandlers {
    PayloadError(): null {
      return null;
    }
  }

  // A missing own property is unhandled for partial recovery rather than
  // malformed, so handle returns the original failure.
  const handled = failure.handle(new PartialMethodHandlers());

  expect(handled).toBe(failure);

  if (handled.isOk) throw new Error("Expected the failure to pass through");
  expect(handled.code).toBe("PayloadError");
});

test("each invocation receives a fresh context with dynamic detachable raisers", () => {
  const observedContexts: object[] = [];
  const observedReceivers: unknown[] = [];
  const symbolCode = Symbol("SymbolError");
  const run = wrapSync(function inspectContext(
    this: unknown,
    errors: Errors<{ StopError: NoReason }>,
    shouldStop: boolean,
  ): string {
    observedContexts.push(errors);
    observedReceivers.push(this);
    expect(typeof Reflect.get(errors, "UnknownError")).toBe("function");
    expect(Reflect.get(errors, symbolCode)).toBeUndefined();

    const stop = errors.StopError;
    if (shouldStop) stop();
    return "visible result";
  });
  const success = Reflect.apply(run, { applicationReceiver: true }, [false]);
  const failure = run(true);

  if (!success.isOk) throw new Error("Expected a success result");
  if (failure.isOk) throw new Error("Expected a failure result");

  expect(success.data).toBe("visible result");
  expect(failure.code).toBe("StopError");
  expect(failure.reason).toBeUndefined();
  expect(observedContexts).toHaveLength(2);
  expect(observedContexts[0]).not.toBe(observedContexts[1]);
  expect(observedReceivers).toEqual([undefined, undefined]);

  const dynamicReason = { source: "dynamic raiser" };
  const unknownFailure = wrapSync(
    (errors: Errors<{ KnownError: NoReason }>): never => {
      const undeclared = Reflect.get(errors, "UnknownError") as (
        reason: unknown,
      ) => never;
      return undeclared(dynamicReason);
    },
  )();

  if (unknownFailure.isOk) throw new Error("Expected a dynamic failure");
  expect(Reflect.get(unknownFailure, "code")).toBe("UnknownError");
  expect(Reflect.get(unknownFailure, "reason")).toBe(dynamicReason);
});

test("same-invocation catch and rethrow stays declared while spoofed codes do not", () => {
  const reason = { message: "same invocation" };
  let caughtInsideInvocation: unknown;

  const catchAndRethrow = wrapSync(
    (errors: Errors<{ LocalError: PayloadReason }>): never => {
      try {
        return errors.LocalError(reason);
      } catch (thrownValue) {
        caughtInsideInvocation = thrownValue;
        throw thrownValue;
      }
    },
  );

  const declaredResult = catchAndRethrow();
  if (declaredResult.isOk)
    throw new Error("Expected a declared failure result");

  expect(declaredResult.code).toBe("LocalError");
  expect(declaredResult.reason).toBe(reason);
  expect(declaredResult.unwrap((error) => error)).toBe(caughtInsideInvocation);

  const spoofedError = Object.assign(new Error("spoofed"), {
    code: "LocalError",
    name: "LocalError",
    reason,
  });
  const spoofedResult = wrapSync((_errors: NoErrors) => {
    throw spoofedError;
  })();

  if (spoofedResult.isOk)
    throw new Error("Expected an unexpected failure result");

  expect(spoofedResult.code).toBe("UnexpectedError");
  expect(spoofedResult.reason).toBe(spoofedError);
});

test("stored and inline wrappers reject raisers captured from another invocation", () => {
  type Raiser = (reason: string) => never;
  let storedRaiser: Raiser | undefined;

  const storedWrapper = wrapSync(
    (errors: Errors<{ StoredError: string }>, capture: boolean): string => {
      if (capture) {
        storedRaiser = errors.StoredError;
        return "captured";
      }

      if (storedRaiser === undefined)
        throw new Error("Raiser was not captured");
      return storedRaiser("foreign stored raise");
    },
  );

  const captureResult = storedWrapper(true);
  const storedForeignResult = storedWrapper(false);

  expect(captureResult.isOk).toBe(true);
  if (storedForeignResult.isOk) throw new Error("Expected a foreign failure");

  expect(storedForeignResult.code).toBe("UnexpectedError");
  expectDeclaredError(
    storedForeignResult.reason,
    "StoredError",
    "foreign stored raise",
  );

  let inlineRaiser: Raiser | undefined;
  const inlineCapture = wrapSync(
    (errors: Errors<{ InlineError: string }>): string => {
      inlineRaiser = errors.InlineError;
      return "captured";
    },
  )();

  expect(inlineCapture.isOk).toBe(true);

  const inlineForeignResult = wrapSync(
    (_errors: Errors<{ InlineError: string }>): never => {
      if (inlineRaiser === undefined)
        throw new Error("Raiser was not captured");
      return inlineRaiser("foreign inline raise");
    },
  )();

  if (inlineForeignResult.isOk) throw new Error("Expected a foreign failure");

  expect(inlineForeignResult.code).toBe("UnexpectedError");
  expectDeclaredError(
    inlineForeignResult.reason,
    "InlineError",
    "foreign inline raise",
  );
});

test("recursive invocations use distinct declared-error identities", () => {
  const recursiveReason = { depth: 0 };
  let callRecursively = (_depth: number): number => {
    throw new Error("Recursive wrapper is not initialized");
  };

  const recursiveWrapper = wrapSync(
    (
      errors: Errors<{ RecursiveError: { readonly depth: number } }>,
      depth: number,
    ): number => {
      if (depth === 0) errors.RecursiveError(recursiveReason);
      return callRecursively(depth - 1);
    },
  );

  callRecursively = (depth) =>
    recursiveWrapper(depth).unwrap((error) => {
      throw error;
    });

  const result = recursiveWrapper(1);
  if (result.isOk) throw new Error("Expected a recursive failure result");

  expect(result.code).toBe("UnexpectedError");
  expectDeclaredError(result.reason, "RecursiveError", recursiveReason);
});

test("re-entry through user code cannot borrow the inner invocation identity", () => {
  let reenter = (): string => {
    throw new Error("Re-entry callback is not initialized");
  };

  const reentrantWrapper = wrapSync(
    (errors: Errors<{ ReentryError: string }>, enterAgain: boolean): string => {
      if (!enterAgain) errors.ReentryError("inner invocation");
      return reenter();
    },
  );

  reenter = () =>
    reentrantWrapper(false).unwrap((error) => {
      throw error;
    });

  const result = reentrantWrapper(true);
  if (result.isOk) throw new Error("Expected a re-entrant failure result");

  expect(result.code).toBe("UnexpectedError");
  expectDeclaredError(result.reason, "ReentryError", "inner invocation");
});

test("concurrent async invocations cannot borrow each other's raisers", async () => {
  type ConcurrentReason = { readonly owner: string };
  type ConcurrentRaiser = (reason: ConcurrentReason) => never;

  const ownerReady = createDeferred<void>();
  const releaseOwner = createDeferred<void>();
  const borrowedReason = { owner: "owner invocation" };
  let ownerRaiser: ConcurrentRaiser | undefined;

  const concurrentWrapper = wrapAsync(
    async (
      errors: Errors<{ ConcurrentError: ConcurrentReason }>,
      role: "owner" | "borrower",
    ): Promise<string> => {
      if (role === "owner") {
        ownerRaiser = errors.ConcurrentError;
        ownerReady.resolve();
        await releaseOwner.promise;
        return "owner completed";
      }

      await ownerReady.promise;
      if (ownerRaiser === undefined)
        throw new Error("Owner raiser was not captured");
      return ownerRaiser(borrowedReason);
    },
  );

  const ownerResultPromise = concurrentWrapper("owner");
  await ownerReady.promise;

  const borrowerResult = await concurrentWrapper("borrower");

  if (borrowerResult.isOk) throw new Error("Expected a foreign async failure");

  expect(borrowerResult.code).toBe("UnexpectedError");
  expectDeclaredError(borrowerResult.reason, "ConcurrentError", borrowedReason);

  releaseOwner.resolve();
  const ownerResult = await ownerResultPromise;

  if (!ownerResult.isOk) throw new Error("Expected the owner to succeed");
  expect(ownerResult.data).toBe("owner completed");
});

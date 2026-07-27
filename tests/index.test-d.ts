/**
 * Type-level conformance tests for the public TypeScript API.
 *
 * Vitest recognizes the `*.test-d.ts` suffix and statically analyzes this file
 * without executing it. The root TypeScript configuration also includes it,
 * while the production build excludes the entire test directory.
 */

import { assertType, expectTypeOf, test } from "vitest";

import {
  type Errors,
  UnexpectedError,
  wrapAsync,
  wrapSync,
} from "../src/index.js";

/**
 * Keeps invalid examples type-checkable without allowing them to execute if
 * this compile-only module is accidentally imported at runtime.
 */
function includeNegativeTypeTests(): boolean {
  return false;
}

/** The specification's exact no-reason type. */
// biome-ignore lint/suspicious/noConfusingVoidType: These tests must exercise the public contract's distinct void behavior.
type NoReason = void;

/** A context for an implementation with no declared error codes. */
// biome-ignore lint/complexity/noBannedTypes: The v0.1 specification explicitly spells the empty error map as Errors<{}>.
type NoErrors = Errors<{}>;

class ExtendedUnexpectedError extends UnexpectedError {}

class DeepExtendedUnexpectedError extends ExtendedUnexpectedError {}

class TaggedUnexpectedError extends UnexpectedError {
  constructor(
    reason: unknown,
    readonly tag: string,
  ) {
    super(reason);
  }
}

class StringReasonUnexpectedError extends UnexpectedError {
  // biome-ignore lint/complexity/noUselessConstructor: The explicit narrowed parameter is the behavior under test.
  constructor(reason: string) {
    super(reason);
  }
}

abstract class AbstractUnexpectedError extends UnexpectedError {}

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

test("types raisers, control flow, and explicit Errors<E> contexts", () => {
  type ExerciseErrors = Errors<{
    NotFoundError: NoReason;
    OptionalError: string | NoReason;
    ValidationError: { input: string };
  }>;

  const exerciseRaisers = wrapSync(
    (errors: ExerciseErrors, shouldReturn: boolean): number => {
      expectTypeOf(errors.NotFoundError).toEqualTypeOf<() => never>();
      expectTypeOf(errors.OptionalError).toEqualTypeOf<
        (reason?: string) => never
      >();
      expectTypeOf(errors.ValidationError).toEqualTypeOf<
        (reason: { input: string }) => never
      >();
      expectTypeOf(errors.UnexpectedError).toEqualTypeOf<
        (reason?: unknown) => never
      >();

      expectTypeOf(errors.NotFoundError).returns.toBeNever();
      expectTypeOf(errors.OptionalError).returns.toBeNever();
      expectTypeOf(errors.ValidationError).returns.toBeNever();
      expectTypeOf(errors.UnexpectedError).returns.toBeNever();

      const detachedRaiser: (reason: { input: string }) => never =
        errors.ValidationError;
      expectTypeOf(detachedRaiser).returns.toBeNever();

      const detachedUnexpectedRaiser: (reason?: unknown) => never =
        errors.UnexpectedError;
      expectTypeOf(detachedUnexpectedRaiser).returns.toBeNever();

      if (includeNegativeTypeTests()) {
        errors.UnexpectedError();
        errors.UnexpectedError({ source: "explicit unexpected failure" });

        // @ts-expect-error The universal raiser accepts at most one reason.
        errors.UnexpectedError("reason", "extra");

        // @ts-expect-error A void reason does not accept an argument.
        errors.NotFoundError(undefined);

        errors.OptionalError();
        errors.OptionalError("details");

        // @ts-expect-error The optional reason is a string when present.
        errors.OptionalError(123);

        // @ts-expect-error A required reason cannot be omitted.
        errors.ValidationError();

        // @ts-expect-error The required payload must retain its declared shape.
        errors.ValidationError({ message: "invalid" });

        // @ts-expect-error Raiser properties are readonly.
        errors.NotFoundError = () => {
          throw new Error("replacement");
        };

        // @ts-expect-error The universal raiser is readonly too.
        errors.UnexpectedError = () => {
          throw new Error("replacement");
        };
      }

      if (shouldReturn) return 1;
      return errors.NotFoundError();
    },
  );

  expectTypeOf(exerciseRaisers).parameters.toEqualTypeOf<[boolean]>();

  const narrowAfterRaise = wrapSync(
    (
      errors: Errors<{ MissingError: NoReason }>,
      value: string | undefined,
    ): string => {
      if (value === undefined) errors.MissingError();
      expectTypeOf(value).toEqualTypeOf<string>();
      return value;
    },
  );
  expectTypeOf(narrowAfterRaise).parameters.toEqualTypeOf<
    [value: string | undefined]
  >();

  const narrowAfterUnexpectedRaise = wrapSync(
    (errors: NoErrors, value: string | undefined): string => {
      if (value === undefined) errors.UnexpectedError();
      expectTypeOf(value).toEqualTypeOf<string>();
      return value;
    },
  );
  expectTypeOf(narrowAfterUnexpectedRaise).parameters.toEqualTypeOf<
    [value: string | undefined]
  >();

  type AliasedErrors = Errors<{ AliasedError: { id: string } }>;
  const aliased = wrapSync((errors: AliasedErrors): never =>
    errors.AliasedError({ id: "42" }),
  );
  expectTypeOf(aliased).parameters.toEqualTypeOf<[]>();

  const bareAnyContext = wrapSync(
    // biome-ignore lint/suspicious/noExplicitAny: Acceptance of a bare any context is the behavior under test.
    (errors: any, input: string): string => {
      errors.NotStaticallyDeclared();
      return input;
    },
  );
  expectTypeOf(bareAnyContext).parameters.toEqualTypeOf<[input: string]>();
  expectTypeOf<
    Extract<ReturnType<typeof bareAnyContext>, { isOk: false }>["code"]
  >().toEqualTypeOf<"UnexpectedError">();

  const omittedContextAnnotation = wrapSync((errors, input: string): string => {
    expectTypeOf(errors.UnexpectedError).toEqualTypeOf<
      (reason?: unknown) => never
    >();

    if (includeNegativeTypeTests()) {
      // @ts-expect-error An omitted annotation infers object, so no declared raiser is known.
      errors.NotStaticallyDeclared();
    }

    return input;
  });
  expectTypeOf(omittedContextAnnotation).parameters.toEqualTypeOf<
    [input: string]
  >();
  expectTypeOf<
    Extract<
      ReturnType<typeof omittedContextAnnotation>,
      { isOk: false }
    >["code"]
  >().toEqualTypeOf<"UnexpectedError">();

  if (includeNegativeTypeTests()) {
    // @ts-expect-error Errors<any> cannot preserve an exact error map.
    // biome-ignore lint/suspicious/noExplicitAny: Rejection of Errors<any> is the behavior under test.
    wrapSync((_errors: Errors<any>, input: string): string => input);

    // @ts-expect-error UnexpectedError is reserved and cannot be declared.
    wrapSync((_errors: Errors<{ UnexpectedError: NoReason }>): number => 1);

    // @ts-expect-error Numeric error keys are not string codes.
    wrapSync((_errors: Errors<{ 404: string }>): number => 1);

    // @ts-expect-error Symbol error keys are not string codes.
    wrapSync((_errors: Errors<{ [Symbol.iterator]: string }>): number => 1);
  }
});

test("distinguishes an exact undefined reason from a void reason", () => {
  const exerciseUndefinedReason = wrapSync(
    (
      errors: Errors<{
        UndefinedReasonError: undefined;
        VoidReasonError: NoReason;
      }>,
      input: string,
    ): number => {
      expectTypeOf(errors.UndefinedReasonError).toEqualTypeOf<
        (reason: undefined) => never
      >();
      expectTypeOf(errors.VoidReasonError).toEqualTypeOf<() => never>();

      if (includeNegativeTypeTests()) {
        // @ts-expect-error An exact undefined reason requires an explicit argument.
        errors.UndefinedReasonError();
      }

      if (input === "undefined") errors.UndefinedReasonError(undefined);
      return input.length;
    },
  );

  const result = exerciseUndefinedReason("undefined");

  if (!result.isOk) {
    switch (result.code) {
      case "UndefinedReasonError":
        expectTypeOf(result.reason).toEqualTypeOf<undefined>();
        break;
      case "VoidReasonError":
        expectTypeOf(result.reason).toEqualTypeOf<undefined>();
        break;
      case "UnexpectedError":
        expectTypeOf(result.reason).toBeUnknown();
        break;
      default:
        assertType<never>(result);
    }
  }
});

test("accepts quoted numeric-like codes as ordinary string keys", () => {
  const raiseQuotedCode = wrapSync(
    (errors: Errors<{ "404": NoReason }>, input: string): number => {
      expectTypeOf(errors["404"]).toEqualTypeOf<() => never>();

      if (input === "missing") errors["404"]();
      return input.length;
    },
  );

  const result = raiseQuotedCode("missing");

  if (!result.isOk) {
    expectTypeOf(result.code).toEqualTypeOf<"404" | "UnexpectedError">();

    switch (result.code) {
      case "404":
        expectTypeOf(result.reason).toEqualTypeOf<undefined>();
        break;
      case "UnexpectedError":
        expectTypeOf(result.reason).toBeUnknown();
        break;
      default:
        assertType<never>(result);
    }
  }

  const unwrapped = result.unwrap({
    "404": () => null,
    UnexpectedError,
  });

  expectTypeOf(unwrapped).toEqualTypeOf<number | null>();

  if (includeNegativeTypeTests()) {
    // @ts-expect-error Exhaustive unwrap also requires quoted string codes.
    result.unwrap({ UnexpectedError });
  }
});

type OperationErrors = Errors<{
  NotFoundError: NoReason;
  OptionalError: string | NoReason;
  ValidationError: { input: string };
}>;

const declaredOperation = wrapSync(
  (errors: OperationErrors, input: string): number => {
    if (input === "missing") errors.NotFoundError();
    if (input === "optional") errors.OptionalError();
    if (input === "invalid") errors.ValidationError({ input });

    if (includeNegativeTypeTests()) {
      // @ts-expect-error Only declared raisers are available on the context.
      errors.UnknownError();
    }

    return input.length;
  },
);

const declaredAsyncOperation = wrapAsync(
  (errors: OperationErrors, input: string): number => {
    if (input === "missing") errors.NotFoundError();
    if (input === "optional") errors.OptionalError();
    if (input === "invalid") errors.ValidationError({ input });
    return input.length;
  },
);

test("infers wrapper inputs, results, thenables, and generics", () => {
  function noErrorsOperation(
    errors: NoErrors,
    value: number,
    radix?: number,
  ): string {
    expectTypeOf(errors.UnexpectedError).toEqualTypeOf<
      (reason?: unknown) => never
    >();
    return value.toString(radix);
  }

  function nestedThenableOperation(
    _errors: NoErrors,
  ): PromiseLike<PromiseLike<number>> {
    throw new Error("compile-only fixture");
  }

  const genericOperation = wrapSync(
    <Value>(
      _errors: Errors<{ GenericError: NoReason }>,
      input: string,
    ): Value => input as Value,
  );

  function runGenericOperation<Value>(input: string) {
    return wrapSync(
      (_errors: Errors<{ GenericError: NoReason }>, value: string): Value =>
        value as Value,
    )(input);
  }

  const wrappedDeclaredSync = declaredOperation;
  expectTypeOf(wrappedDeclaredSync).parameters.toEqualTypeOf<[string]>();

  const declaredResult = wrappedDeclaredSync("valid");
  const sameHandle = declaredResult.handle;
  const sameUnwrap = declaredResult.unwrap;

  if (declaredResult.isOk) {
    expectTypeOf(declaredResult.data).toEqualTypeOf<number>();

    // @ts-expect-error Success results have no error code.
    declaredResult.code;
  } else {
    expectTypeOf(declaredResult.code).toEqualTypeOf<
      "NotFoundError" | "OptionalError" | "UnexpectedError" | "ValidationError"
    >();

    switch (declaredResult.code) {
      case "NotFoundError":
        expectTypeOf(declaredResult.reason).toEqualTypeOf<undefined>();
        break;
      case "OptionalError":
        expectTypeOf(declaredResult.reason).toEqualTypeOf<string | undefined>();
        break;
      case "ValidationError":
        expectTypeOf(declaredResult.reason).toEqualTypeOf<{ input: string }>();
        break;
      case "UnexpectedError":
        expectTypeOf(declaredResult.reason).toBeUnknown();
        break;
      default:
        assertType<never>(declaredResult);
    }
  }

  // Result fields and operations are deliberately mutable.
  declaredResult.unwrap = sameUnwrap;
  declaredResult.handle = sameHandle;

  if (declaredResult.isOk) {
    declaredResult.isOk = true;
    declaredResult.data = 0;
  } else {
    declaredResult.isOk = false;
    declaredResult.code = "UnexpectedError";
    declaredResult.reason = undefined;
  }

  const wrappedDeclaredAsync = declaredAsyncOperation;
  expectTypeOf(wrappedDeclaredAsync).parameters.toEqualTypeOf<[string]>();

  void wrappedDeclaredAsync("valid").then((asyncDeclaredResult) => {
    if (asyncDeclaredResult.isOk) {
      expectTypeOf(asyncDeclaredResult.data).toEqualTypeOf<number>();
    } else {
      expectTypeOf(asyncDeclaredResult.code).toEqualTypeOf<
        | "NotFoundError"
        | "OptionalError"
        | "UnexpectedError"
        | "ValidationError"
      >();
    }
  });

  const wrappedNoErrors = wrapSync(noErrorsOperation);
  expectTypeOf<Parameters<typeof wrappedNoErrors>>().toEqualTypeOf<
    [value: number, radix?: number | undefined]
  >();

  const noErrorsResult = wrappedNoErrors(15, 16);

  if (noErrorsResult.isOk) {
    expectTypeOf(noErrorsResult.data).toEqualTypeOf<string>();
  } else {
    expectTypeOf(noErrorsResult.code).toEqualTypeOf<"UnexpectedError">();
    expectTypeOf(noErrorsResult.reason).toBeUnknown();
  }

  const asyncThenableResult = wrapAsync(nestedThenableOperation)();

  void asyncThenableResult.then((result) => {
    if (result.isOk) {
      expectTypeOf(result.data).toEqualTypeOf<number>();
    }
  });

  const syncThenableResult = wrapSync(nestedThenableOperation)();

  if (syncThenableResult.isOk) {
    expectTypeOf(syncThenableResult.data).toEqualTypeOf<
      PromiseLike<PromiseLike<number>>
    >();
  }

  const hoistedGenericResult = genericOperation("value");

  if (hoistedGenericResult.isOk) {
    expectTypeOf(hoistedGenericResult.data).toBeUnknown();
  }

  const localGenericResult = runGenericOperation<{ id: 1 }>("value");

  if (localGenericResult.isOk) {
    expectTypeOf(localGenericResult.data).toEqualTypeOf<{ id: 1 }>();
  }
});

test("types the unexpected-only try shorthands", () => {
  function parseInteger(input: string, radix?: number): number {
    return Number.parseInt(input, radix);
  }

  function fetchLike(
    url: string,
    options?: { readonly method: "GET" | "POST" },
  ): PromiseLike<PromiseLike<{ readonly status: number }>> {
    throw new Error(`Compile-only request for ${url} with ${options?.method}`);
  }

  expectTypeOf<keyof typeof wrapAsync>().toEqualTypeOf<"try">();
  expectTypeOf<keyof typeof wrapSync>().toEqualTypeOf<"try">();

  const safeParseInteger = wrapSync.try(parseInteger);
  expectTypeOf<Parameters<typeof safeParseInteger>>().toEqualTypeOf<
    [input: string, radix?: number | undefined]
  >();

  const parsed = safeParseInteger("2a", 16);
  if (parsed.isOk) {
    expectTypeOf(parsed.data).toEqualTypeOf<number>();
  } else {
    expectTypeOf(parsed.code).toEqualTypeOf<"UnexpectedError">();
    expectTypeOf(parsed.reason).toBeUnknown();
  }

  const stringify = wrapSync.try(JSON.stringify);
  const serialized = stringify({ ready: true });
  if (serialized.isOk) {
    expectTypeOf(serialized.data).toEqualTypeOf<string>();
  }

  const preservedPromise = wrapSync.try((value: number) =>
    Promise.resolve(value),
  )(42);
  if (preservedPromise.isOk) {
    expectTypeOf(preservedPromise.data).toEqualTypeOf<Promise<number>>();
  }

  const safeFetch = wrapAsync.try(fetchLike);
  expectTypeOf<Parameters<typeof safeFetch>>().toEqualTypeOf<
    [url: string, options?: { readonly method: "GET" | "POST" } | undefined]
  >();

  void safeFetch("/api/users", { method: "GET" }).then((result) => {
    if (result.isOk) {
      expectTypeOf(result.data).toEqualTypeOf<{ readonly status: number }>();
    } else {
      expectTypeOf(result.code).toEqualTypeOf<"UnexpectedError">();
      expectTypeOf(result.reason).toBeUnknown();
    }
  });
});

test("rejects wrapped implementations that require a receiver", () => {
  type Receiver = { readonly prefix: string };

  function declaredOperationWithReceiver(
    this: Receiver,
    _errors: NoErrors,
    value: string,
  ): string {
    return `${this.prefix}${value}`;
  }

  function tryOperationWithReceiver(this: Receiver, value: string): string {
    return `${this.prefix}${value}`;
  }

  if (includeNegativeTypeTests()) {
    // @ts-expect-error Primary sync implementations cannot require a receiver.
    wrapSync(declaredOperationWithReceiver);

    // @ts-expect-error Primary async implementations cannot require a receiver.
    wrapAsync(declaredOperationWithReceiver);

    // @ts-expect-error Sync try implementations cannot require a receiver.
    wrapSync.try(tryOperationWithReceiver);

    // @ts-expect-error Async try implementations cannot require a receiver.
    wrapAsync.try(tryOperationWithReceiver);
  }

  const receiver: Receiver = { prefix: "user:" };
  const boundDeclared = wrapSync(declaredOperationWithReceiver.bind(receiver));
  const boundTry = wrapSync.try(tryOperationWithReceiver.bind(receiver));

  expectTypeOf(boundDeclared).parameters.toEqualTypeOf<[value: string]>();
  expectTypeOf(boundTry).parameters.toEqualTypeOf<[value: string]>();
});

test("types UnexpectedError and the exact value exports", () => {
  const originalError: unknown = new Error("boom");
  const unexpectedError = new UnexpectedError(originalError);
  const extendedUnexpectedError = new DeepExtendedUnexpectedError(
    originalError,
  );
  const subclassConstructor: typeof UnexpectedError =
    DeepExtendedUnexpectedError;

  expectTypeOf(unexpectedError).toMatchTypeOf<Error>();
  expectTypeOf(unexpectedError.code).toEqualTypeOf<"UnexpectedError">();
  expectTypeOf(unexpectedError.reason).toBeUnknown();
  expectTypeOf(unexpectedError.cause).toBeUnknown();
  expectTypeOf(extendedUnexpectedError).toMatchTypeOf<UnexpectedError>();
  expectTypeOf(subclassConstructor).toEqualTypeOf<typeof UnexpectedError>();

  if (includeNegativeTypeTests()) {
    // @ts-expect-error UnexpectedError fields are readonly.
    unexpectedError.reason = "replacement";

    // @ts-expect-error UnexpectedError fields are readonly.
    unexpectedError.cause = "replacement";

    // @ts-expect-error UnexpectedError fields are readonly.
    unexpectedError.code = "UnexpectedError";

    // @ts-expect-error A structural lookalike lacks the private nominal brand.
    const lookalikeConstructor: typeof UnexpectedError =
      StructuralUnexpectedError;
    void lookalikeConstructor;

    // @ts-expect-error A sentinel must be constructible from one unknown reason.
    const incompatibleConstructor: typeof UnexpectedError =
      TaggedUnexpectedError;
    void incompatibleConstructor;

    // @ts-expect-error A sentinel must be a concrete constructor.
    const abstractConstructor: typeof UnexpectedError = AbstractUnexpectedError;
    void abstractConstructor;
  }

  expectTypeOf<keyof typeof import("../src/index.js")>().toEqualTypeOf<
    "UnexpectedError" | "wrapAsync" | "wrapSync"
  >();
});

test("types every unwrap form", () => {
  const declaredResult = declaredOperation("valid");
  const bareValue = declaredResult.unwrap();
  expectTypeOf(bareValue).toEqualTypeOf<number>();

  // Keep the catch-all signature last so the preceding object overload drives
  // contextual property completion for exhaustive handler literals.
  const lastUnwrapArgument: Parameters<typeof declaredResult.unwrap>[0] = (
    error,
  ) => error;
  void lastUnwrapArgument;

  const exhaustivelyUnwrapped = declaredResult.unwrap({
    NotFoundError: () => null,
    OptionalError: (reason) => {
      expectTypeOf(reason).toEqualTypeOf<string | undefined>();
      return reason?.length ?? 0;
    },
    UnexpectedError,
    ValidationError: (reason) => {
      expectTypeOf(reason).toEqualTypeOf<{ input: string }>();
      return reason.input;
    },
  });

  expectTypeOf(exhaustivelyUnwrapped).toEqualTypeOf<number | string | null>();

  const sentinelOnlyValue = declaredResult.unwrap({
    NotFoundError: UnexpectedError,
    OptionalError: UnexpectedError,
    UnexpectedError,
    ValidationError: UnexpectedError,
  });

  expectTypeOf(sentinelOnlyValue).toEqualTypeOf<number>();

  const subclassSentinelValue = declaredResult.unwrap({
    NotFoundError: DeepExtendedUnexpectedError,
    OptionalError: DeepExtendedUnexpectedError,
    UnexpectedError: DeepExtendedUnexpectedError,
    ValidationError: DeepExtendedUnexpectedError,
  });

  expectTypeOf(subclassSentinelValue).toEqualTypeOf<number>();

  if (includeNegativeTypeTests()) {
    declaredResult.unwrap({
      // @ts-expect-error Exhaustive unwrap requires every possible error code.
      NotFoundError: () => null,
      OptionalError: () => null,
      UnexpectedError,
    });

    declaredResult.unwrap({
      // @ts-expect-error Subclasses with additional required constructor arguments cannot be sentinels.
      NotFoundError: TaggedUnexpectedError,
      OptionalError: UnexpectedError,
      UnexpectedError,
      ValidationError: UnexpectedError,
    });

    declaredResult.unwrap({
      // @ts-expect-error Sentinel constructors must accept every unknown reason.
      NotFoundError: StringReasonUnexpectedError,
      OptionalError: UnexpectedError,
      UnexpectedError,
      ValidationError: UnexpectedError,
    });

    // @ts-expect-error Abstract subclasses cannot be constructed as sentinels.
    declaredResult.handle({ NotFoundError: AbstractUnexpectedError });

    declaredResult.handle({
      // @ts-expect-error Sentinel constructors must accept every unknown reason.
      NotFoundError: StringReasonUnexpectedError,
    });
  }

  const handlersWithExtraCode = {
    ExtraError: () => null,
    NotFoundError: () => null,
    OptionalError: () => null,
    UnexpectedError,
    ValidationError: () => null,
  };

  if (includeNegativeTypeTests()) {
    // @ts-expect-error Exhaustive unwrap rejects extra inferred keys.
    declaredResult.unwrap(handlersWithExtraCode);
  }

  const handlersWithNarrowReason = {
    NotFoundError: () => null,
    OptionalError: () => null,
    UnexpectedError,
    ValidationError: (_reason: { input: "literal" }) => null,
  };

  if (includeNegativeTypeTests()) {
    // @ts-expect-error Handlers cannot require a narrower reason type.
    declaredResult.unwrap(handlersWithNarrowReason);
  }

  const catchAllValue = declaredResult.unwrap((error) => {
    switch (error.code) {
      case "NotFoundError":
        expectTypeOf(error.reason).toEqualTypeOf<undefined>();
        return null;
      case "OptionalError":
        expectTypeOf(error.reason).toEqualTypeOf<string | undefined>();
        return error.reason?.length ?? 0;
      case "ValidationError":
        expectTypeOf(error.reason).toEqualTypeOf<{ input: string }>();
        return error.reason.input;
      case "UnexpectedError":
        expectTypeOf(error).toEqualTypeOf<UnexpectedError>();
        throw error;
    }
  });

  expectTypeOf(catchAllValue).toEqualTypeOf<number | string | null>();

  const throwingCatchAllValue = declaredResult.unwrap((error) => {
    throw error;
  });

  expectTypeOf(throwingCatchAllValue).toEqualTypeOf<number>();

  const asyncCatchAllValue = declaredResult.unwrap(
    async (error): Promise<string> => error.code,
  );
  expectTypeOf(asyncCatchAllValue).toEqualTypeOf<number | Promise<string>>();

  const asyncMapValue = declaredResult.unwrap({
    NotFoundError: async () => "missing",
    OptionalError: UnexpectedError,
    UnexpectedError,
    ValidationError: UnexpectedError,
  });

  expectTypeOf(asyncMapValue).toEqualTypeOf<number | Promise<string>>();
});

test("types selective handle recovery", () => {
  const declaredResult = declaredOperation("valid");
  const withoutNotFound = declaredResult.handle({
    NotFoundError: () => null,
  });

  if (withoutNotFound.isOk) {
    expectTypeOf(withoutNotFound.data).toEqualTypeOf<number | null>();
  } else {
    expectTypeOf(withoutNotFound.code).toEqualTypeOf<
      "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const escalatedNotFound = declaredResult.handle({
    NotFoundError: UnexpectedError,
  });

  if (escalatedNotFound.isOk) {
    expectTypeOf(escalatedNotFound.data).toEqualTypeOf<number>();
  } else {
    expectTypeOf(escalatedNotFound.code).toEqualTypeOf<
      "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const subclassEscalatedNotFound = declaredResult.handle({
    NotFoundError: DeepExtendedUnexpectedError,
  });

  if (subclassEscalatedNotFound.isOk) {
    expectTypeOf(subclassEscalatedNotFound.data).toEqualTypeOf<number>();
  } else {
    expectTypeOf(subclassEscalatedNotFound.code).toEqualTypeOf<
      "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const emptyHandled = declaredResult.handle({});
  assertType<typeof declaredResult>(emptyHandled);
  assertType<typeof emptyHandled>(declaredResult);

  const optionalHandlers: {
    NotFoundError?: () => null;
  } = {};

  const optionallyHandled = declaredResult.handle(optionalHandlers);

  if (optionallyHandled.isOk) {
    expectTypeOf(optionallyHandled.data).toEqualTypeOf<number | null>();
  }

  if (!optionallyHandled.isOk) {
    expectTypeOf(optionallyHandled.code).toEqualTypeOf<
      "NotFoundError" | "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const optionalSentinelHandlers: {
    ValidationError?: typeof UnexpectedError;
  } = {};

  const optionallyEscalated = declaredResult.handle(optionalSentinelHandlers);

  if (!optionallyEscalated.isOk) {
    expectTypeOf(optionallyEscalated.code).toEqualTypeOf<
      "NotFoundError" | "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const requiredHandlers: {
    NotFoundError: () => null;
  } = {
    NotFoundError: () => null,
  };

  const requiredHandled = declaredResult.handle(requiredHandlers);

  if (!requiredHandled.isOk) {
    expectTypeOf(requiredHandled.code).toEqualTypeOf<
      "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const explicitlyUndefined = declaredResult.handle({
    NotFoundError: undefined,
  });

  assertType<typeof declaredResult>(explicitlyUndefined);
  assertType<typeof explicitlyUndefined>(declaredResult);

  const maybeHandlers: {
    NotFoundError: (() => null) | undefined;
  } = {
    NotFoundError: undefined,
  };
  const maybeHandled = declaredResult.handle(maybeHandlers);

  if (maybeHandled.isOk) {
    expectTypeOf(maybeHandled.data).toEqualTypeOf<number | null>();
  } else {
    expectTypeOf(maybeHandled.code).toEqualTypeOf<
      "NotFoundError" | "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }

  const withoutUnexpected = declaredResult.handle({
    UnexpectedError: () => 0,
  });

  if (!withoutUnexpected.isOk) {
    expectTypeOf(withoutUnexpected.code).toEqualTypeOf<
      "NotFoundError" | "OptionalError" | "ValidationError"
    >();
  }

  const escalatedUnexpected = declaredResult.handle({ UnexpectedError });

  if (!escalatedUnexpected.isOk) {
    expectTypeOf(escalatedUnexpected.code).toEqualTypeOf<
      "NotFoundError" | "OptionalError" | "ValidationError"
    >();
  }

  const fullyRecovered = declaredResult.handle({
    NotFoundError: () => 0,
    OptionalError: () => 0,
    UnexpectedError: () => 0,
    ValidationError: () => 0,
  });

  expectTypeOf(fullyRecovered.isOk).toEqualTypeOf<true>();
  expectTypeOf(fullyRecovered.data).toEqualTypeOf<number>();

  if (includeNegativeTypeTests()) {
    // @ts-expect-error A fully recovered result has no failure code.
    fullyRecovered.code;
  }

  const fullyEscalated = declaredResult.handle({
    NotFoundError: UnexpectedError,
    OptionalError: UnexpectedError,
    UnexpectedError,
    ValidationError: UnexpectedError,
  });

  expectTypeOf(fullyEscalated.isOk).toEqualTypeOf<true>();
  expectTypeOf(fullyEscalated.data).toEqualTypeOf<number>();

  const asyncHandled = declaredResult.handle({
    NotFoundError: async () => "missing",
  });

  if (asyncHandled.isOk) {
    expectTypeOf(asyncHandled.data).toEqualTypeOf<number | Promise<string>>();
  }

  const handleWithNarrowReason = {
    ValidationError: (_reason: { input: "literal" }) => 0,
  };

  if (includeNegativeTypeTests()) {
    // @ts-expect-error A structural lookalike is not a handle sentinel.
    declaredResult.handle({ NotFoundError: StructuralUnexpectedError });

    // @ts-expect-error Handle rejects unknown error codes.
    declaredResult.handle({ ExtraError: () => null });

    // @ts-expect-error Handle callbacks cannot require a narrower reason type.
    declaredResult.handle(handleWithNarrowReason);
  }

  const chainedValue = declaredResult
    .handle({ NotFoundError: () => null })
    .unwrap({
      OptionalError: () => null,
      UnexpectedError,
      ValidationError: (reason) => reason.input,
    });

  expectTypeOf(chainedValue).toEqualTypeOf<number | string | null>();
});

test("class-instance handler maps type-check although operations need own properties", () => {
  const declaredResult = declaredOperation("valid");

  class ExhaustiveMethodHandlers {
    NotFoundError(): null {
      return null;
    }

    OptionalError(): null {
      return null;
    }

    UnexpectedError(reason: unknown): never {
      throw reason;
    }

    ValidationError(reason: { input: string }): string {
      return reason.input;
    }
  }

  // Structural typing sees prototype methods as properties, even though
  // runtime unwrap will reject the map because none are own properties.
  const unwrapped = declaredResult.unwrap(new ExhaustiveMethodHandlers());
  expectTypeOf(unwrapped).toEqualTypeOf<number | string | null>();

  class PartialMethodHandlers {
    NotFoundError(): null {
      return null;
    }
  }

  // The returned type removes NotFoundError even though runtime handle will
  // not recover a prototype method. The specification documents this
  // limitation and recommends plain object literals as handler maps.
  const handled = declaredResult.handle(new PartialMethodHandlers());

  if (!handled.isOk) {
    expectTypeOf(handled.code).toEqualTypeOf<
      "OptionalError" | "UnexpectedError" | "ValidationError"
    >();
  }
});

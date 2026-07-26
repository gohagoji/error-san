/** A map from error codes to their reason types. */
type ErrorMap = object;

/** The empty map used to distinguish optional handler properties. */
type EmptyErrorMap = Record<never, never>;

/** Keeps the public distinction between void and undefined. */
// biome-ignore lint/suspicious/noConfusingVoidType: void has unique public raiser behavior.
type VoidReason = void;

/** A native error raised by one invocation's generated raisers. */
class ExpectedError<
  Code extends string = string,
  Reason = unknown,
> extends Error {
  readonly #boundary: object;

  readonly code: Code;
  readonly reason: Reason;

  /** Checks provenance without exposing the retained boundary. */
  static isFrom(error: ExpectedError, boundary: object): boolean {
    return error.#boundary === boundary;
  }

  constructor(code: Code, reason: Reason, boundary: object) {
    super(code);
    this.code = code;
    this.reason = reason;
    this.#boundary = boundary;
    this.name = code;
  }
}

/** A declaration-only private key that makes UnexpectedError nominal. */
declare const unexpectedErrorBrand: unique symbol;

/**
 * An error that retains the reason for an unexpected failure.
 *
 * @remarks
 * {@link reason} and {@link cause} both contain the original value. Wrappers
 * preserve existing instances instead of wrapping them again. Use this class,
 * or a concrete subclass that accepts an unknown reason, as an `unwrap` or
 * `handle` handler when the failure should be thrown.
 *
 * @example
 * ```ts
 * import { UnexpectedError, wrapSync } from "error-san";
 *
 * const parseJson = wrapSync.try(JSON.parse);
 *
 * try {
 *   parseJson("{").unwrap();
 * } catch (error) {
 *   if (error instanceof UnexpectedError) {
 *     console.error("Could not parse JSON", error.reason);
 *   }
 * }
 * ```
 */
export class UnexpectedError extends Error {
  /** Prevents unrelated structural lookalikes from acting as sentinels. */
  private declare readonly [unexpectedErrorBrand]: never;

  /** The code used for the universal unexpected failure branch. */
  readonly code = "UnexpectedError" as const;

  /** The original value that caused the failure. */
  readonly reason: unknown;

  /** The same original value, exposed as an own `cause` property. */
  override readonly cause: unknown;

  /**
   * Creates an unexpected error that retains its original reason.
   *
   * @param reason - The value that caused the failure.
   */
  constructor(reason: unknown) {
    super("UnexpectedError");
    this.name = "UnexpectedError";
    this.reason = reason;
    this.cause = reason;
  }
}

/** A concrete unexpected-error constructor that accepts every reason. */
type UnexpectedErrorConstructor = new (reason: unknown) => UnexpectedError;

/** Extracts the string codes that can appear in a failure result. */
type ErrorCode<PossibleErrors extends ErrorMap> = keyof PossibleErrors & string;

/** Selects the raiser arguments required by a declared reason. */
type RaiserArgs<Reason> = [Reason] extends [undefined]
  ? [reason: Reason]
  : [Reason] extends [VoidReason]
    ? []
    : [VoidReason] extends [Reason]
      ? [reason?: Exclude<Reason, VoidReason>]
      : [reason: Reason];

/** Gives a failure result the payload exposed for a declared reason. */
type PublicReason<Reason> =
  RaiserArgs<Reason> extends [] ? undefined : RaiserArgs<Reason>[0];

/** Extracts function output while a construct-only sentinel yields never. */
type HandlerOutput<Handler> = Handler extends (...args: never[]) => infer Output
  ? Output
  : never;

/** Collects every callable output in a handler map. */
type HandlerOutputs<Handlers> = HandlerOutput<Handlers[keyof Handlers]>;

/** Rejects inferred object keys outside an operation's accepted codes. */
type ExactKeys<Input, AllowedKeys extends PropertyKey> = Input &
  Record<Exclude<keyof Input, AllowedKeys>, never>;

/** Requires a function or sentinel for every possible error. */
type ExhaustiveHandlers<PossibleErrors extends ErrorMap> = {
  [Code in ErrorCode<PossibleErrors>]:
    | ((reason: PublicReason<PossibleErrors[Code]>) => unknown)
    | UnexpectedErrorConstructor;
};

/** Correlates every catch-all error with its public code and reason. */
type ResultError<PossibleErrors extends ErrorMap> = {
  [Code in ErrorCode<PossibleErrors>]: Code extends "UnexpectedError"
    ? UnexpectedError
    : ExpectedError<Code, PublicReason<PossibleErrors[Code]>>;
}[ErrorCode<PossibleErrors>];

/** The three unwrap forms shared by all result variants. */
interface Unwrap<Data, PossibleErrors extends ErrorMap> {
  /**
   * Returns success data or throws an {@link UnexpectedError}.
   *
   * @returns The result's current success data.
   * @throws {@link UnexpectedError} with a retained declared error as its
   * reason, or rethrows an existing instance.
   *
   * @example
   * ```ts
   * const value = result.unwrap();
   * ```
   */
  (): Data;

  /**
   * Returns success data or passes the retained error to a fallback.
   *
   * @typeParam Fallback - The callback's output type.
   * @param onError - Receives the exact `Error` retained by the result.
   * @returns The success data or the fallback's output.
   *
   * @remarks
   * The fallback's output is returned as-is, without awaiting promises. Any
   * value it throws escapes unchanged.
   *
   * @example
   * ```ts
   * const value = result.unwrap((error) => {
   *   console.error(error);
   *   return null;
   * });
   * ```
   */
  <Fallback>(
    onError: (error: ResultError<PossibleErrors>) => Fallback,
  ): Data | Fallback;

  /**
   * Returns success data or runs the handler for the active error code.
   *
   * @typeParam Handlers - The exhaustive handler map.
   * @param handlers - One own handler for every possible error code.
   * @returns The success data or the matching handler's output.
   * @throws `TypeError` if the active code has no valid own handler.
   *
   * @remarks
   * Inherited handlers are ignored. Handler output is returned as-is, without
   * awaiting promises, and thrown values escape unchanged. Use
   * `UnexpectedError` or a compatible subclass as a handler to throw instead.
   *
   * @example
   * ```ts
   * const value = result.unwrap({
   *   NotFoundError: () => null,
   *   UnexpectedError,
   * });
   * ```
   */
  <Handlers extends ExhaustiveHandlers<PossibleErrors>>(
    handlers: ExactKeys<Handlers, ErrorCode<PossibleErrors>>,
  ): Data | HandlerOutputs<Handlers>;
}

/** Selects required handlers whose values always prove recovery. */
type DefinitelyHandledCodes<Handlers> = {
  [Code in keyof Handlers]-?: undefined extends Handlers[Code]
    ? never
    : EmptyErrorMap extends Pick<Handlers, Code>
      ? never
      : Code;
}[keyof Handlers];

/** The enumerable data fields for success and correlated failure variants. */
type ResultFields<Data, PossibleErrors extends ErrorMap> =
  | {
      isOk: true;
      data: Data;
    }
  | {
      [Code in ErrorCode<PossibleErrors>]: {
        isOk: false;
        code: Code;
        reason: PublicReason<PossibleErrors[Code]>;
      };
    }[ErrorCode<PossibleErrors>];

/** The selective recovery operation shared by all result variants. */
interface Handle<Data, PossibleErrors extends ErrorMap> {
  /**
   * Handles selected failures and leaves every other result unchanged.
   *
   * @typeParam Handlers - The partial handler map.
   * @param handlers - Own handlers for the selected error codes.
   * @returns The original success or unhandled failure, or a new success
   * containing the matching handler's output.
   * @throws `TypeError` for an invalid, defined own handler.
   *
   * @remarks
   * A required handler removes its code unless its type includes `undefined`.
   * `undefined` entries and inherited handlers are ignored. Output is stored
   * without awaiting promises, and thrown values escape unchanged. Use
   * `UnexpectedError` or a compatible subclass to throw instead.
   *
   * @example
   * ```ts
   * const recovered = result.handle({
   *   NotFoundError: () => null,
   *   UnexpectedError,
   * });
   * ```
   */
  // biome-ignore lint/style/useShorthandFunctionType: The interface keeps TSDoc on this public call signature.
  <
    Handlers extends {
      [Code in ErrorCode<PossibleErrors>]?:
        | ExhaustiveHandlers<PossibleErrors>[Code]
        | undefined;
    },
  >(
    handlers: ExactKeys<Handlers, ErrorCode<PossibleErrors>>,
  ): Result<
    Data | HandlerOutputs<Handlers>,
    Omit<PossibleErrors, DefinitelyHandledCodes<Handlers>>
  >;
}

/** The declaration-visible result returned by every wrapper. */
type Result<Data, PossibleErrors extends ErrorMap> = ResultFields<
  Data,
  PossibleErrors
> & {
  /** Returns success data or handles the failure. */
  unwrap: Unwrap<Data, PossibleErrors>;
  /** Recovers selected failures and returns another result. */
  handle: Handle<Data, PossibleErrors>;
};

/** A mutable success result with one shared operation prototype. */
class SuccessResult<Data> {
  isOk: true;
  data: Data;

  constructor(data: Data) {
    this.isOk = true;
    this.data = data;
  }

  /** Promise fulfillment callback shared by asynchronous wrappers. */
  static from<Data>(data: Data): SuccessResult<Data> {
    return new SuccessResult(data);
  }

  unwrap(): Data {
    return this.data;
  }

  handle(): this {
    return this;
  }
}

/** Recognizes UnexpectedError and concrete subclasses as sentinels. */
function isUnexpectedErrorSentinel(
  value: unknown,
): value is UnexpectedErrorConstructor {
  if (value === UnexpectedError) return true;
  if (typeof value !== "function") return false;

  return value.prototype instanceof UnexpectedError;
}

/** A mutable failure result that privately retains its classified error. */
class FailureResult {
  readonly #failure: ExpectedError | UnexpectedError;

  isOk: false;
  code: string;
  reason: unknown;

  /** Promise rejection callback shared by unexpected-only async wrappers. */
  static fromUnexpected(thrownValue: unknown): FailureResult {
    return new FailureResult(thrownValue);
  }

  constructor(thrownValue: unknown, boundary?: object) {
    let failure: ExpectedError | UnexpectedError | undefined;

    try {
      if (thrownValue instanceof UnexpectedError) {
        failure = thrownValue;
      } else if (
        boundary !== undefined &&
        thrownValue instanceof ExpectedError &&
        ExpectedError.isFrom(thrownValue, boundary)
      ) {
        failure = thrownValue;
      }
    } catch {
      // Values hostile to prototype inspection are still unexpected failures.
    }

    failure ??= new UnexpectedError(thrownValue);

    this.#failure = failure;
    this.isOk = false;
    this.code =
      failure instanceof UnexpectedError ? "UnexpectedError" : failure.code;
    this.reason = failure.reason;
  }

  /** Escalates the retained error through the selected sentinel class. */
  #throwAsUnexpected(
    ErrorConstructor: UnexpectedErrorConstructor = UnexpectedError,
  ): never {
    const failure = this.#failure;

    if (!(failure instanceof UnexpectedError)) {
      throw new ErrorConstructor(failure);
    }

    if (failure instanceof ErrorConstructor) {
      throw failure;
    }

    // A selected subclass does not make every UnexpectedError its instance,
    // despite TypeScript narrowing the negative branch to never.
    throw new ErrorConstructor((failure as UnexpectedError).reason);
  }

  unwrap(...args: unknown[]): unknown {
    const { code, reason } = this;

    if (args.length === 0) {
      return this.#throwAsUnexpected();
    }

    const argument = args[0];

    if (typeof argument === "function") {
      return argument(this.#failure);
    }

    if (!Object.hasOwn(argument as object, code)) {
      throw new TypeError(`No callable unwrap handler for ${code}`);
    }

    const handler = (argument as Record<string, unknown>)[code];

    if (isUnexpectedErrorSentinel(handler)) {
      return this.#throwAsUnexpected(handler);
    }

    if (typeof handler !== "function") {
      throw new TypeError(`No callable unwrap handler for ${code}`);
    }

    return handler(reason);
  }

  handle(handlers: unknown): unknown {
    const { code, reason } = this;

    if (!Object.hasOwn(handlers as object, code)) {
      return this;
    }

    const handler = (handlers as Record<string, unknown>)[code];

    if (handler === undefined) {
      return this;
    }

    if (isUnexpectedErrorSentinel(handler)) {
      return this.#throwAsUnexpected(handler);
    }

    if (typeof handler !== "function") {
      throw new TypeError(`No callable handle handler for ${code}`);
    }

    return new SuccessResult(handler(reason));
  }
}

/** Gives a raiser the parameter list required by its reason type. */
type Raiser<Reason> = (...args: RaiserArgs<Reason>) => never;

/** The universal raiser available on every injected error context. */
type UnexpectedErrorRaiser = (reason?: unknown) => never;

/** The readonly declared and universal raisers injected into one invocation. */
type Raisers<DeclaredErrors extends ErrorMap> = {
  readonly [Code in keyof DeclaredErrors]: Raiser<DeclaredErrors[Code]>;
} & {
  readonly UnexpectedError: UnexpectedErrorRaiser;
};

/** A private declaration-only key carrying an error context's exact map. */
declare const declaredErrors: unique symbol;

/**
 * The typed error raisers injected into a wrapped function.
 *
 * @typeParam E - String error codes mapped to their reason types.
 *
 * @remarks
 * Use `Errors<E>` on the first parameter of a function passed to `wrapAsync`
 * or `wrapSync`; callers do not see that parameter. A `void` reason takes no
 * argument, `T | void` accepts an optional argument, and other reason types
 * require one. Every context also provides `errors.UnexpectedError(reason?)`.
 * `UnexpectedError` is reserved and cannot be declared in `E`.
 *
 * @example
 * ```ts
 * import { type Errors, wrapSync } from "error-san";
 *
 * const requireName = wrapSync((
 *   errors: Errors<{ MissingNameError: void }>,
 *   name: string | undefined,
 * ) => {
 *   if (name === undefined) errors.MissingNameError();
 *   return name;
 * });
 * ```
 */
export type Errors<E extends ErrorMap> = "UnexpectedError" extends keyof E
  ? never
  : Exclude<keyof E, string> extends never
    ? Raisers<E> & {
        readonly [declaredErrors]: E;
      }
    : never;

/** Every declared error plus the universal unexpected branch. */
type AllPossibleErrors<DeclaredErrors extends ErrorMap> = DeclaredErrors & {
  UnexpectedError: unknown;
};

/** The universal failure map returned by wrappers without declared errors. */
type UnexpectedOnlyErrors = AllPossibleErrors<EmptyErrorMap>;

/** A function type whose concrete parameters and output can be extracted. */
// biome-ignore lint/suspicious/noExplicitAny: This constraint must accept every concrete parameter list.
type TryFunction = (this: void, ...args: any[]) => unknown;

/** Throws a fresh unexpected error without retaining invocation state. */
function raiseUnexpectedError(reason?: unknown): never {
  throw new UnexpectedError(reason);
}

/** Shared dynamic raiser behavior inherited by every invocation context. */
const invocationErrorsPrototype = Object.freeze(
  new Proxy(Object.create(null) as object, {
    get(_target, property, receiver) {
      if (typeof property !== "string") return undefined;

      if (property === "UnexpectedError") {
        return raiseUnexpectedError;
      }

      return (reason?: unknown): never => {
        throw new ExpectedError(property, reason, receiver);
      };
    },
  }),
);

/** A constructor for ordinary invocation provenance boundaries. */
type InvocationErrorsConstructor = {
  new (): object;
  prototype: object;
};

/** Constructs an ordinary provenance boundary with the shared proxy prototype. */
const InvocationErrors = function InvocationErrors(): void {
  // Invocation objects need no own initialization.
} as unknown as InvocationErrorsConstructor;

InvocationErrors.prototype = invocationErrorsPrototype;

/** The asynchronous wrapper value and its unexpected-only shorthand. */
interface WrapAsync {
  /**
   * Wraps a function, awaits its output, and returns a typed result.
   *
   * @typeParam E - The function's declared error map.
   * @typeParam Args - The caller-visible parameters.
   * @typeParam Data - The function's return type.
   * @param fn - Its first parameter receives typed raisers and is hidden from
   * callers.
   * @returns A function that fulfills with a success or failure result.
   *
   * @remarks
   * Each call gives `fn` a fresh error context and invokes it immediately.
   * Promises and thenables are recursively awaited. Throws and rejections
   * become failure results. The wrapper does not forward `this`.
   *
   * @example
   * ```ts
   * import { type Errors, wrapAsync } from "error-san";
   *
   * const readText = wrapAsync(async (
   *   errors: Errors<{ RequestError: { status: number } }>,
   *   url: string,
   * ) => {
   *   const response = await fetch(url);
   *   if (!response.ok) errors.RequestError({ status: response.status });
   *   return response.text();
   * });
   * ```
   */
  <E extends ErrorMap, Args extends unknown[], Data>(
    fn: (this: void, errors: Errors<E>, ...args: Args) => Data,
  ): (...args: Args) => Promise<Result<Awaited<Data>, AllPossibleErrors<E>>>;

  /**
   * Wraps a function that does not declare errors.
   *
   * @typeParam Fn - The function type to preserve.
   * @param fn - The function to wrap without injecting an error context.
   * @returns A function with the same parameters that fulfills with a result
   * whose only failure code is `UnexpectedError`.
   *
   * @remarks
   * Each wrapper call invokes `fn` immediately. Promises and thenables are
   * recursively awaited. Throws and rejections become `UnexpectedError`
   * failures. The wrapper does not forward `this`.
   *
   * @example
   * ```ts
   * import { wrapAsync } from "error-san";
   *
   * const safeFetch = wrapAsync.try(fetch);
   * const response = (await safeFetch("/api/users/42")).unwrap();
   * ```
   */
  try<Fn extends TryFunction>(
    fn: Fn,
  ): (
    ...args: Parameters<Fn>
  ) => Promise<Result<Awaited<ReturnType<Fn>>, UnexpectedOnlyErrors>>;
}

/**
 * Creates wrappers that turn throws and rejections into typed results.
 *
 * Use an `Errors<E>` first parameter to declare errors, or `wrapAsync.try`
 * when the function needs no error context.
 *
 * @example
 * ```ts
 * import { wrapAsync } from "error-san";
 *
 * const safeFetch = wrapAsync.try(fetch);
 * const result = await safeFetch("/api/users/42");
 * ```
 */
export const wrapAsync: WrapAsync = Object.assign(
  function wrapAsync<E extends ErrorMap, Args extends unknown[], Data>(
    fn: (this: void, errors: Errors<E>, ...args: Args) => Data,
  ): (...args: Args) => Promise<Result<Awaited<Data>, AllPossibleErrors<E>>> {
    return ((...args: Args) => {
      const errors = new InvocationErrors();

      try {
        const value = fn(errors as Errors<E>, ...args);

        // Two callbacks keep a success-result construction error out of the
        // wrapper's rejection classification.
        return Promise.resolve(value).then(
          SuccessResult.from,
          (thrownValue) => new FailureResult(thrownValue, errors),
        );
      } catch (thrownValue) {
        return Promise.resolve(new FailureResult(thrownValue, errors));
      }
    }) as (
      ...args: Args
    ) => Promise<Result<Awaited<Data>, AllPossibleErrors<E>>>;
  },
  {
    try<Fn extends TryFunction>(
      fn: Fn,
    ): (
      ...args: Parameters<Fn>
    ) => Promise<Result<Awaited<ReturnType<Fn>>, UnexpectedOnlyErrors>> {
      return ((...args: Parameters<Fn>) => {
        try {
          const value = (fn as (...args: Parameters<Fn>) => ReturnType<Fn>)(
            ...args,
          );

          return Promise.resolve(value).then(
            SuccessResult.from,
            FailureResult.fromUnexpected,
          );
        } catch (thrownValue) {
          return Promise.resolve(new FailureResult(thrownValue));
        }
      }) as (
        ...args: Parameters<Fn>
      ) => Promise<Result<Awaited<ReturnType<Fn>>, UnexpectedOnlyErrors>>;
    },
  },
);

/** The synchronous wrapper value and its unexpected-only shorthand. */
interface WrapSync {
  /**
   * Wraps a function without awaiting its output and returns a typed result.
   *
   * @typeParam E - The function's declared error map.
   * @typeParam Args - The caller-visible parameters.
   * @typeParam Data - The function's return type.
   * @param fn - Its first parameter receives typed raisers and is hidden from
   * callers.
   * @returns A function that returns the success or failure immediately.
   *
   * @remarks
   * Each call gives `fn` a fresh error context. Throws become failure results.
   * Returned promises and thenable-shaped values stay as success data; their
   * `then` property is never read. The wrapper does not forward `this`.
   *
   * @example
   * ```ts
   * import { type Errors, wrapSync } from "error-san";
   *
   * const parsePort = wrapSync((
   *   errors: Errors<{ InvalidPortError: { input: string } }>,
   *   input: string,
   * ) => {
   *   const port = Number(input);
   *   if (!Number.isInteger(port)) errors.InvalidPortError({ input });
   *   return port;
   * });
   * ```
   */
  <E extends ErrorMap, Args extends unknown[], Data>(
    fn: (this: void, errors: Errors<E>, ...args: Args) => Data,
  ): (...args: Args) => Result<Data, AllPossibleErrors<E>>;

  /**
   * Wraps a function without declaring errors or awaiting its output.
   *
   * @typeParam Fn - The function type to preserve.
   * @param fn - The function to wrap without injecting an error context.
   * @returns A function with the same parameters that returns a result whose
   * only failure code is `UnexpectedError`.
   *
   * @remarks
   * Throws become `UnexpectedError` failures. Returned promises and
   * thenable-shaped values stay as success data; their `then` property is never
   * read. The wrapper does not forward `this`.
   *
   * @example
   * ```ts
   * import { wrapSync } from "error-san";
   *
   * const stringify = wrapSync.try(JSON.stringify);
   * const json = stringify({ ready: true }).unwrap();
   * ```
   */
  try<Fn extends TryFunction>(
    fn: Fn,
  ): (...args: Parameters<Fn>) => Result<ReturnType<Fn>, UnexpectedOnlyErrors>;
}

/**
 * Creates wrappers that turn synchronous throws into typed results.
 *
 * Use an `Errors<E>` first parameter to declare errors, or `wrapSync.try`
 * when the function needs no error context.
 *
 * @example
 * ```ts
 * import { wrapSync } from "error-san";
 *
 * const parseJson = wrapSync.try(JSON.parse);
 * const result = parseJson('{"ready":true}');
 * ```
 */
export const wrapSync: WrapSync = Object.assign(
  function wrapSync<E extends ErrorMap, Args extends unknown[], Data>(
    fn: (this: void, errors: Errors<E>, ...args: Args) => Data,
  ): (...args: Args) => Result<Data, AllPossibleErrors<E>> {
    return ((...args: Args) => {
      const errors = new InvocationErrors();

      try {
        return new SuccessResult(fn(errors as Errors<E>, ...args));
      } catch (thrownValue) {
        return new FailureResult(thrownValue, errors);
      }
    }) as (...args: Args) => Result<Data, AllPossibleErrors<E>>;
  },
  {
    try<Fn extends TryFunction>(
      fn: Fn,
    ): (
      ...args: Parameters<Fn>
    ) => Result<ReturnType<Fn>, UnexpectedOnlyErrors> {
      return ((...args: Parameters<Fn>) => {
        try {
          return new SuccessResult(
            (fn as (...args: Parameters<Fn>) => ReturnType<Fn>)(...args),
          );
        } catch (thrownValue) {
          return new FailureResult(thrownValue);
        }
      }) as (
        ...args: Parameters<Fn>
      ) => Result<ReturnType<Fn>, UnexpectedOnlyErrors>;
    },
  },
);

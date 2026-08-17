# error-san — Specification

**Status:** Released for v0.1 · 2026-07-25

**Package:** TypeScript, ES2022 ESM, zero runtime dependencies

## 1. Overview

error-san turns exception-style raises into typed result data. A wrapped function declares errors through an injected first parameter, and every context also provides an `UnexpectedError` raiser for reporting an undeclared failure.

The v0.1 public surface is:

```ts
import {
  type Errors,
  UnexpectedError,
  wrapAsync,
  wrapSync,
} from "error-san";
```

`wrapAsync.try` and `wrapSync.try` wrap functions that declare no errors and need no injected context. They are properties of the wrappers, not named exports.

Error maps exist only in TypeScript. Each call through a primary wrapper receives a fresh context, and a declared error is recognized only by the invocation that supplied its raiser.

### Scope

The library supports exhaustive per-code handling and preserves thrown values, error identity, and raise-site stacks. It does not validate payloads at runtime or provide a general-purpose Result API, generator or async-iterator wrappers, typed error propagation between wrapped functions, or a supported way to construct, inspect, or extend injected contexts.

## 2. Example

```ts
import { type Errors, UnexpectedError, wrapAsync } from "error-san";

type Data = { id: string; name: string };

const getData = wrapAsync(async (
  errors: Errors<{
    ConnectionError: { message: string };
    NotFoundError: void;
  }>,
  url: string,
) => {
  const response = await fetch(url).catch((cause) =>
    errors.ConnectionError({ message: String(cause) }),
  );

  if (response.status === 404) errors.NotFoundError();

  return (await response.json()) as Data;
});

const result = await getData("https://api.example.com/data");

if (result.isOk) {
  console.log(result.data.name);
} else {
  switch (result.code) {
    case "ConnectionError":
      console.error(result.reason.message);
      break;
    case "NotFoundError":
      break;
    case "UnexpectedError":
      throw result.reason;
  }
}
```

The result can also be consumed with exhaustive handlers:

```ts
const data = result.unwrap({
  ConnectionError: UnexpectedError,
  NotFoundError: () => null,
  UnexpectedError,
});
// Data | null
```

A broad catch around a declared raise can intercept and relabel it, so keep such catches narrow.

## 3. `Errors<E>` and raisers

`Errors<E>` is a type-only export. `E` maps string codes to reason types; each entry becomes a readonly raiser. Every context, including `Errors<{}>`, also has the readonly raiser `UnexpectedError(reason?: unknown): never`.

In a primary wrapper, annotate the first parameter as `Errors<E>`, directly or through an alias. This declares the result's error codes and lets raiser calls participate in control-flow narrowing. Without the annotation, the result exposes only `UnexpectedError`. `Errors<any>` is rejected; a bare `any` parameter bypasses static checking. Functions passed to `.try` omit the context parameter.

Error codes follow these rules:

- `UnexpectedError` is reserved and cannot be declared in `E`.
- Codes must be strings. `PascalCase` ending in `Error` is only a convention.
- Numeric and symbol keys are type errors. A quoted numeric-looking key such as `"404"` is a valid string code.

Each code produces a readonly raiser whose signature depends on its reason:

| Declared reason | Raiser | Result `reason` |
| --- | --- | --- |
| `void` | `() => never` | `undefined` |
| `P \| void` | `(reason?: P) => never` | supplied `P` or `undefined` |
| any other `P` | `(reason: P) => never` | supplied `P` |

`undefined` alone requires an explicit `undefined` argument; only `void` makes the raiser argument-free.

The universal raiser throws a new exported `UnexpectedError` with the supplied reason, or `undefined` when omitted. Wrappers from the same loaded copy retain that instance and its raise-site stack.

Raisers are detachable and return `never`. A declared raiser remains bound to its originating invocation; the universal raiser is not invocation-specific.

At runtime, string property reads create raisers dynamically, while symbol reads do not. Codes and reason payloads are not validated.

## 4. Wrappers

Conceptually, the wrapper signatures are:

```ts
wrapAsync(fn: (this: void, errors: Errors<E>, ...args: A) => T):
  (...args: A) => Promise<Result<Awaited<T>, E>>;

wrapSync(fn: (this: void, errors: Errors<E>, ...args: A) => T):
  (...args: A) => Result<T, E>;

wrapAsync.try<F extends (this: void, ...args: any[]) => unknown>(fn: F):
  (...args: Parameters<F>) =>
    Promise<Result<Awaited<ReturnType<F>>, {}>>;

wrapSync.try<F extends (this: void, ...args: any[]) => unknown>(fn: F):
  (...args: Parameters<F>) => Result<ReturnType<F>, {}>;
```

`E`, `A`, and `T` are the declared error map, caller arguments, and return type. `Result` is descriptive, not a named export; it includes every code in `E` and the universal `UnexpectedError` branch.

The primary form injects a fresh context as the implementation's first argument and removes it from the returned function's parameters. Implementations have a `this: void` call signature, and wrappers do not forward a dynamic `this`.

An implementation using the primary form always has a context parameter. With no declared codes, it uses `Errors<{}>`:

```ts
const parseJson = wrapSync(
  (_errors: Errors<{}>, source: string): unknown => JSON.parse(source),
);
```

Its result still includes the `UnexpectedError` branch.

### `.try`

Each wrapper value has a `.try` method for a function that declares no errors:

```ts
const safeFetch = wrapAsync.try(fetch);
const stringify = wrapSync.try(JSON.stringify);
```

The function keeps its full parameter list, receives no context, and produces a result with only the `UnexpectedError` failure branch. Otherwise, `.try` has the same observable behavior as the corresponding primary form with `Errors<{}>`.

### `wrapAsync`

- Calls the implementation immediately and returns a native promise that fulfills with a result.
- Recursively assimilates promises and thenables, so success data is `Awaited<T>`.
- Converts synchronous throws and rejections into fulfilled failure results.

Use it when a promise or thenable represents asynchronous work.

### `wrapSync`

- Returns a result immediately and converts synchronous throws into failure results.
- Preserves the returned value without reading or assimilating `then`; promises and thenables are ordinary success data.

Use it for synchronous work, including when a promise or thenable-shaped value is intentionally data.

## 5. Result model

A wrapper returns a discriminated union with one success variant and one failure variant per possible code:

```ts
{ isOk: true, data }
{ isOk: false, code, reason }
```

Every variant also has `unwrap` and `handle` methods.

- `isOk` narrows success from failure; `code` then narrows a failure's `reason`.
- Failures include every declared code and `UnexpectedError`, whose `reason` is `unknown`.
- Results are mutable and extensible.
- Data fields are enumerable own properties. `unwrap` and `handle` are non-enumerable inherited methods shared by all instances of the same variant, so keys, spread, serialization, and structured cloning expose only data.
- Methods depend on their receiver; detached calls are unsupported.

Mutation is not a supported way to reclassify a result. Its original variant and retained error do not change, while operations otherwise read the current `data`, `code`, and `reason`.

### `UnexpectedError` and retained errors

The exported `UnexpectedError`:

- extends `Error`;
- has `name` and `code` equal to `"UnexpectedError"`;
- exposes its original value through `reason` and its own `cause` property; and
- is recognized by every wrapper from the same loaded copy through `instanceof UnexpectedError`.

`UnexpectedError` may be extended. A handler sentinel must be `UnexpectedError` or a concrete subclass constructible as `new (reason: unknown) => UnexpectedError`. Unrelated or abstract classes and incompatible constructors are rejected.

A declared raise retains a native `Error` with its literal `code`, typed `reason`, identity, and raise-site stack. It is exposed only to a catch-all `unwrap` callback or as the `reason` and `cause` of a sentinel-created unexpected error.

When a handler selects a sentinel class:

- A declared error constructs the selected class with the retained declared error.
- An existing unexpected error is rethrown if it is already an instance of that class; otherwise the selected class is constructed with its public `reason`.

## 6. `unwrap`

`unwrap` has three forms and never awaits handlers. On failure, the argument picks the form: none is bare, a callable is the catch-all, and anything else is a handler map.

### Bare `result.unwrap()`

On success, return `data`. On failure:

- A declared error throws a new `UnexpectedError` whose reason is the retained declared error.
- An existing `UnexpectedError` or subclass instance is rethrown unchanged.

### Exhaustive `result.unwrap(handlers)`

The handler map must contain exactly one entry for every error in the result type. Missing and extra keys are type errors.

- A function receives its code's public `reason`.
- An `UnexpectedError` sentinel follows section 5 and contributes `never`.
- The return type combines the success type with every function handler's output. Promise outputs are included as-is.
- Only the current `code`'s own entry is read; a missing, inherited, or invalid entry throws `TypeError`.

### Catch-all `result.unwrap(onError)`

The callback receives the retained error: the native declared error or the retained `UnexpectedError`. Its output is combined with the success type; if it always throws, only the success type remains. Promise output is returned as-is.

## 7. `handle`

`result.handle(handlers)` selectively recovers or escalates failures and returns a result on every non-throwing path.

- The map may contain any subset of the current error codes and no others.
- Success and unhandled failures return the original result unchanged.
- A function receives its code's public `reason` and returns a new success result with its output as `data`.
- A sentinel follows section 5 and does not return.
- A required handler removes its code unless its type includes `undefined`.
- Only the current `code`'s own entry is read: `undefined` and inherited entries are ignored, and any other invalid entry throws `TypeError`.
- A throwing handler escapes unchanged; `handle` is not an error boundary.
- Async handler output is stored as data and is not awaited.

An empty map leaves the result type unchanged. Handling every error yields only a success branch; sentinel paths do not return.

## 8. Error provenance

A declared error is recognized only by the invocation whose context raised it:

| Thrown value | Failure result |
| --- | --- |
| an `UnexpectedError` or subclass from the same loaded copy | `UnexpectedError`, retaining the same instance |
| an error raised by this invocation | its declared `code` and reason |
| an error raised by another invocation | `UnexpectedError`, with the foreign error as `reason` |
| any other value | `UnexpectedError`, with that value as `reason` |

An unexpected result always has `code: "UnexpectedError"`; retaining an existing error does not modify it.

Classification uses invocation identity, never code strings, so concurrent, recursive, and re-entrant calls remain distinct. Catching and rethrowing within the original invocation preserves a declared error; crossing another wrapper boundary converts it to `UnexpectedError`. Existing unexpected errors from the same loaded copy cross later boundaries without nesting.

These guarantees are package-copy-local. An `UnexpectedError` from another physical copy is treated as foreign and wrapped in a new `UnexpectedError`. Context, sentinel, and error types from separate copies are incompatible, so consumers that exchange them must resolve error-san to one copy.

## 9. TypeScript requirements

error-san targets TypeScript 7.x and newer. Earlier versions may work but are unsupported. Consumers must enable `strict`, including:

- `strictNullChecks`, which preserves reason and result distinctions involving `void`, `undefined`, and optional values; and
- `strictFunctionTypes`, which prevents handlers from accepting payloads narrower than they may receive.

`exactOptionalPropertyTypes` may be enabled or disabled.

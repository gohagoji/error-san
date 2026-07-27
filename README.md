# error-san

> Typed error handling: declare, `throw`, done.

error-san brings typed errors to ordinary TypeScript functions:

- ✍️ **Declare errors beside the implementation** — no error classes or registry.
- 💥 **Raise them like exceptions** — keep straightforward control flow inside the function.
- 📦 **Receive every outcome as typed data** — including errors you did not declare.
- ✅ **Handle errors exhaustively** — TypeScript flags missing handlers.
- 🪶 **Less than 1 kB minified + gzipped** — zero dependencies, with support for browsers, workers, and Node.js.

**Performance:** Successful synchronous calls are relatively lightweight.
Raising an error costs more because it captures a stack trace. If errors are
common in a hot path, benchmark your workload or consider returning them
directly.

Here is the whole model:

```ts
import { type Errors, UnexpectedError, wrapAsync } from "error-san";

type Data = { id: string; name: string };

const getData = wrapAsync(
  async (
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
  },
);

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

Or consume the result with exhaustive handlers:

```ts
const data = result.unwrap({
  ConnectionError: UnexpectedError, // rethrow as `UnexpectedError`
  NotFoundError: () => null, // provide a fallback value
  UnexpectedError, // rethrow anything else
});
// Data | null
```

This README is a guided tour. [`SPEC.md`](./SPEC.md) is the complete contract.

## Installation

```sh
npm install error-san
# or
pnpm add error-san
# or
yarn add error-san
```

**Requirements:**

- ES2022 with native ES modules: modern browsers, workers, or Node.js 22+.
- TypeScript 7.x or newer with `strict` enabled. Earlier versions may work but
  are unsupported. See [TypeScript setup](#typescript-setup).

## Quick start

error-san has one workflow: **declare, wrap, raise, consume.**

### 1. Declare errors and wrap the implementation

List each error code and its reason type in `Errors<E>`, then use that type on
the implementation's first parameter. Callers see only the remaining
parameters:

```ts
import { type Errors, UnexpectedError, wrapAsync } from "error-san";

type User = { id: string; name: string };

const getUser = wrapAsync(
  async (
    errors: Errors<{
      NetworkError: { message: string }; // raising requires a payload
      NotFoundError: void; // raising takes no argument
      ResponseError: { status: number };
    }>,
    id: string,
  ) => {
    const response = await fetch(`/api/users/${id}`).catch((cause) =>
      errors.NetworkError({ message: String(cause) }),
    );

    if (response.status === 404) errors.NotFoundError();
    if (!response.ok) errors.ResponseError({ status: response.status });
    return (await response.json()) as User;
  },
);
```

`Errors<E>` exists only in TypeScript. Runtime raisers do not validate codes or
payloads.

### 2. Raise them like exceptions

Each declared code becomes a **raiser** on `errors`. A raiser throws and
returns `never`, so TypeScript knows that code after it does not run:

```ts
const response = await fetch(`/api/users/${id}`).catch((cause) =>
  errors.NetworkError({ message: String(cause) }),
);

if (response.status === 404) errors.NotFoundError();
if (!response.ok) errors.ResponseError({ status: response.status });

return (await response.json()) as User; // only reached on success
```

### 3. Call the wrapped function

`wrapAsync` injects a fresh error context and turns every outcome into data:

```ts
const result = await getUser("42");
```

Callers do not pass the error context.

Use [`wrapSync`](#synchronous-functions) for synchronous work. For functions
without declared errors, [`.try`](#functions-without-declared-errors) omits the
context.

### 4. Consume the result as data

A result is either `{ isOk: true, data }` or
`{ isOk: false, code, reason }`:

```ts
if (result.isOk) {
  console.log(result.data.name); // User
} else if (result.code === "NotFoundError") {
  console.log("No such user");
} else if (result.code === "UnexpectedError") {
  console.error("Unexpected failure", result.reason);
}
```

`UnexpectedError` is always possible. It captures any throw that did not come
from one of the current call's declared raisers; `wrapAsync` also captures
rejections. Its `reason` is the original failure, and you can raise it
explicitly.

Inspect a result directly, or use [`unwrap` and `handle`](#handling-errors) for
exhaustive handling and recovery.

## Raising an unexpected error

Every context, including `Errors<{}>`, can explicitly raise the same fallback
with `errors.UnexpectedError(reason?: unknown)`. Use it for failures outside the
declared contract; declare routine failures in `Errors<E>`.

For example, the API returning a different user than the one requested is an
unexpected failure:

```ts
const user = (await response.json()) as User;

if (user.id !== id) {
  errors.UnexpectedError(
    new Error(`Invariant violated: expected user ${id}, received ${user.id}`),
  );
}

return user;
```

The raiser throws a new `UnexpectedError`. With no argument, its reason is
`undefined`; otherwise, the value is available as both `reason` and `cause`.
Wrappers from the same loaded copy preserve the error and its original stack.

## Handling errors

Results have two methods: `unwrap` returns a value or throws, while `handle`
recovers selected errors and returns another result.

### Exhaustive `unwrap(map)` — handle everything, miss nothing

Pass one handler for every possible error:

```ts
const user = result.unwrap({
  NetworkError: UnexpectedError, // throw
  NotFoundError: () => null, // return a fallback value
  ResponseError: UnexpectedError,
  UnexpectedError,
});
// User | null
```

The map must contain exactly one key per code. Missing or extra keys are type
errors, so contract changes point to every map that needs updating.

Only the map's own properties count. Inherited handlers are ignored; a missing
or invalid handler makes `unwrap` throw `TypeError`.

`UnexpectedError` can also be used as a handler that throws. A compatible
concrete subclass chooses another error class. Because these handlers never
return, they add nothing to the return type.

### Catch-all `unwrap(fn)` — handle every error in one callback

```ts
const user = result.unwrap((error) => {
  if (error.code === "NotFoundError") return null;

  console.error(error);
  throw error;
});
// User | null
```

The callback receives the retained `Error`, not the result. TypeScript narrows
its `reason` from its `code`. Unlike a handler map, this callback also receives
codes added later.

### Bare `unwrap()` — just give me the data

```ts
const user = result.unwrap(); // User, or throws UnexpectedError
```

On a declared error, bare `unwrap` throws a new `UnexpectedError` containing
the code, payload, and original stack. It rethrows an existing
`UnexpectedError` unchanged. Use this form to opt out of typed handling.

> `unwrap` never awaits handlers. It returns an async handler's promise directly.

### `handle(map)` — recover or escalate selectively

`handle` recovers selected errors and can be chained:

```ts
const user = result
  .handle({
    NotFoundError: () => null,
    UnexpectedError,
  })
  .unwrap({
    NetworkError: (reason) => {
      throw new Error(reason.message);
    },
    ResponseError: UnexpectedError,
  });
// User | null
```

How it behaves:

- A function handler turns a matching error into a new success result.
- Success and unhandled errors return the _same_ result object unchanged.
- A required handler removes its code unless its type includes `undefined`.
- `undefined` and inherited entries are ignored; other invalid own entries
  throw `TypeError`.
- The `UnexpectedError` sentinel rules match `unwrap(map)`.
- Thrown values escape unchanged. Async output is stored as success data.

## Functions without declared errors

Use `.try` when a function has no declared errors and needs no context:

```ts
import { wrapAsync, wrapSync } from "error-san";

const safeFetch = wrapAsync.try(fetch);
const response = await safeFetch("/api/users/42");

const stringify = wrapSync.try(JSON.stringify);
const serialized = stringify({ ready: true });
```

The function receives only the arguments you pass. Its only possible failure
code is `"UnexpectedError"`.
`wrapAsync.try` awaits promises and thenables recursively. `wrapSync.try`
preserves them as data without reading `then`.

## Synchronous functions

`wrapSync` handles synchronous work and returns a result immediately:

```ts
import { type Errors, wrapSync } from "error-san";

type Config = { port: number };

const parseConfig = wrapSync(
  (
    errors: Errors<{ InvalidJsonError: { message: string } }>,
    source: string,
  ) => {
    try {
      return JSON.parse(source) as Config;
    } catch (cause) {
      errors.InvalidJsonError({ message: String(cause) });
    }
  },
);

const result = parseConfig('{"port": 3000}');
```

`wrapSync.try` avoids an unused context. Use the primary form with `Errors<{}>`
when the implementation needs `errors.UnexpectedError(reason?)`. Both forms
include the `UnexpectedError` failure branch.

The two wrappers differ only in how they treat the returned value:

|                  | `wrapAsync`                       | `wrapSync`                         |
| ---------------- | --------------------------------- | ---------------------------------- |
| Returns          | a promise fulfilled with a result | a result immediately               |
| Successful data  | recursively awaited               | preserved exactly                  |
| Sync throw       | promised failure result           | immediate failure result           |
| Returned promise | awaited                           | preserved as data                  |
| Custom thenable  | awaited like a promise            | never inspected, `then` never read |

TypeScript infers the result type; the package does not export `Result`.

`wrapAsync` starts the implementation as soon as you call the wrapped
function. Returning a promise does not defer that work.

Use `wrapSync` when a promise or thenable-shaped object is intentionally the
data.

## Declaring reasons

The reason type controls the raiser's call signature:

```ts
const example = wrapSync(
  (
    errors: Errors<{
      NoReasonError: void; // raiser takes no argument
      OptionalReasonError: { detail: string } | void; // optional
      RequiredReasonError: { detail: string }; // required
    }>,
  ) => {
    errors.NoReasonError();
    errors.OptionalReasonError();
    errors.OptionalReasonError({ detail: "optional" });
    errors.RequiredReasonError({ detail: "required" });
  },
);
```

Exactly `undefined` differs from `void`: its raiser requires an explicit
`undefined` argument.

Codes must be strings. Names such as `NotFoundError` are a convention, not a
rule. Numeric and symbol keys are type errors, but a quoted key such as `"404"`
is valid. `UnexpectedError` is reserved because every context and result
already includes it.

## Who raised this error?

A declared error is trusted only when it came from the current call's context.
Classification uses the call's identity, not its error-code string:

- A current-call declared raiser produces its code.
- `errors.UnexpectedError(reason?)` produces and retains a new `UnexpectedError`.
- An existing `UnexpectedError` from the same loaded copy passes through
  unchanged.
- A declared error leaked from another call also becomes `UnexpectedError`.
- Every other throw becomes `UnexpectedError`, with the thrown value as
  `reason`.

An unexpected failure result always has `code: "UnexpectedError"`.

`UnexpectedError` extends `Error` and exposes the original value as both `reason` and `cause`:

```ts
try {
  result.unwrap();
} catch (error) {
  if (error instanceof UnexpectedError) {
    console.error(error.reason);
  }
}
```

You can extend `UnexpectedError`, and wrappers preserve subclass instances.
A concrete subclass whose constructor accepts an `unknown` reason can also be
used as a handler. An existing matching instance is rethrown; otherwise, the
selected subclass is created.

These guarantees require one loaded copy of error-san. Separate copies treat
each other's errors and TypeScript types as foreign, so deduplicate the package
when values cross package boundaries.

## Results serialize as data

Results have enumerable data fields and non-enumerable inherited methods.
Keys, spread, JSON, and structured cloning therefore see only the fields:

```ts
Object.keys(result);
// ["isOk", "data"] or ["isOk", "code", "reason"]

JSON.stringify(result);
// Success: {"isOk":true,"data":...}
// Failure with a serializable reason: {"isOk":false,"code":"...","reason":...}
```

A `void` reason is `undefined`, so JSON omits its `reason` property. Spread and
structured cloning copy the data fields, as long as the payloads can be copied.
Prototype-sensitive comparisons, such as Node.js `assert.deepStrictEqual`, can
still distinguish a result from a plain object.

Call result methods through the result object. Detached methods are not
supported:

```ts
result.unwrap(); // supported

const { unwrap } = result;
unwrap(); // unsupported: the result receiver was lost
```

## Gotchas

### Result mutation is unsupported

Treat results as immutable even though they are writable and extensible.
Changing `isOk` does not change the underlying variant; methods still follow
the original result. Copy the data fields when you need another object.

### Bind receiver-dependent functions before wrapping

Wrappers call implementations as plain functions, so they do not pass through
`this`. TypeScript rejects a function that requires a receiver:

```ts
function format(this: { prefix: string }, value: string): string {
  return `${this.prefix}${value}`;
}

wrapSync.try(format); // type error: format requires a receiver

const formatter = { prefix: "user:" };
const safeFormat = wrapSync.try(format.bind(formatter)); // supported
```

Bind the receiver first, or capture it in a closure or arrow function.

### Keep catches narrower than raises

Raisers throw, so a broad `try/catch` can catch and relabel your own declared
errors:

```ts
// Wrong: errors.NotFoundError() is caught below and becomes NetworkError.
try {
  const response = await fetch(url);
  if (response.status === 404) errors.NotFoundError();
} catch (cause) {
  errors.NetworkError({ message: String(cause) });
}
```

Catch only the operation you are translating, then raise everything else outside it:

```ts
const response = await fetch(url).catch((cause) =>
  errors.NetworkError({ message: String(cause) }),
);

if (response.status === 404) errors.NotFoundError();
```

### Do not stringify the error context

Reading a string property from an injected context produces a raiser.
JavaScript conversion and serialization also read string properties:
`String(errors)` and `${errors}` call a `"toString"` raiser, while
`JSON.stringify(errors)` calls a `"toJSON"` raiser. The wrapper catches the
throw and returns a failure with that undeclared runtime code.

`"toString"` and `"toJSON"` are valid error-code names, so the library cannot
special-case them. Use the context only to read explicitly declared raisers.

### Use a computed handler key for `__proto__`

If an error code is `"__proto__"`, write its handler as a computed property:

```ts
result.unwrap({
  ["__proto__"]: () => null,
  UnexpectedError,
});
```

In an object literal, `{ __proto__: handler }` changes the object's prototype
instead of creating a handler property. It can type-check, but `unwrap` then
throws `TypeError`. The computed form creates the property correctly.

### A structured clone is only a data snapshot

`structuredClone(result)` copies the data fields but not the inherited
`unwrap` and `handle` methods. TypeScript still gives the clone the original
result type, so the missing methods remain visible:

```ts
const snapshot = structuredClone(result);
snapshot.unwrap(); // Type-checks, but throws a TypeError at runtime.
```

Treat a structured clone as data, not as a usable result. Object spread has the
same runtime behavior and the same TypeScript trap.

### Advanced notes

- Every call receives a fresh error context. String property reads produce
  raisers; symbol reads do not. Do not depend on the context's reflective
  shape.
- Raisers can be stored and called later. A declared raiser stays tied to the
  call that created it. The universal `UnexpectedError` raiser does not. Raiser
  identity across repeated reads is unspecified.
- Explicitly annotate the context as `Errors<E>`. `Errors<any>` is rejected,
  while a bare `any` parameter bypasses checking. With no annotation,
  TypeScript knows only `UnexpectedError`, so declared raiser access fails.
- Wrapping a generic function may fix its type parameter. Wrap the call inside
  a small generic function instead.
- `.try` keeps one call signature, not a full overload set. TypeScript's
  `Parameters` and `ReturnType` utilities select the last overload. Wrap the
  call in a small function when you need a different overload.
- Use plain object literals for handler maps. TypeScript cannot tell whether a
  property is inherited, but `unwrap` and `handle` use only properties on the
  map itself. Class methods can therefore type-check, but `unwrap` throws and
  `handle` leaves the error unhandled. Class fields work because they are own
  properties.

## TypeScript setup

Enable `strict`:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

`strict` keeps `void`, `undefined`, and reason types distinct, and prevents a
handler from accepting a payload that is too narrow.

## API reference

The v0.1 surface has one type-only export and three runtime values. The
wrapper methods are properties of their owning values:

| API                 | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `Errors<E>`         | Type-only declaration of readonly raisers, including `UnexpectedError`.       |
| `wrapAsync(fn)`     | Wrap a function and return its result in a promise, awaiting successful data. |
| `wrapAsync.try(fn)` | Async wrapper for a function that needs no error context.                     |
| `wrapSync(fn)`      | Wrap a function and return its result immediately, preserving returned data.  |
| `wrapSync.try(fn)`  | Sync wrapper for a function that needs no error context.                      |
| `UnexpectedError`   | Error class for undeclared failures; use it as a handler to throw.            |

Every result provides:

| Operation            | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `result.unwrap()`    | Return success data or throw `UnexpectedError`.         |
| `result.unwrap(map)` | Exhaustively turn every error into a value or a throw.  |
| `result.unwrap(fn)`  | Route every error through one catch-all callback.       |
| `result.handle(map)` | Recover selected errors and keep working with a result. |

For the complete behavioral and type contract, see [`SPEC.md`](./SPEC.md).

## Limitations (v0.1)

v0.1 does not support generators, async iterators, typed error propagation,
runtime reason validation, or general Result methods such as `map` and
`andThen`.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)

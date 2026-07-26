# Working on error-san

`error-san` is a zero-dependency TypeScript library with a precise public
contract. `SPEC.md` is the source of truth. Preserve each call's error origin,
exhaustive handler types, retained error identity and stacks, data-only result
enumeration, shared result methods, and the intentional async/sync thenable
difference.

## Sources of truth

- `SPEC.md` defines the public API and behavior. Read the relevant sections
  before changing public types, runtime behavior, tests, exports, or
  documentation. If something is unclear, call it out instead of weakening the
  contract.
- `README.md` describes the implemented package. Update it only after the
  implementation matches the specification.

## Verification

```sh
pnpm lint
pnpm test --run
pnpm build
```

Run all three before considering an iteration complete. `pnpm test --run` covers runtime tests, source diagnostics, and `*.test-d.ts` type tests.

## Project constraints

- Publish zero-runtime-dependency ES2022 ESM for browsers and Node.js 22+. Keep runtime code platform-neutral and preserve `sideEffects: false`.
- Use the repository-declared Node.js, pnpm, TypeScript, Vitest, and Biome versions.
- `src/index.ts` is the only public entry point. The package exports the type
  `Errors<E>` and the runtime values `UnexpectedError`, `wrapAsync`, and
  `wrapSync`. Do not export declaration-visible helpers. The `.try` shorthands
  are properties of the wrapper values, not separate named exports.
- `dist/` is generated and gitignored. Never edit it directly.
- Target TypeScript 7.x and newer. Preserve the strict compiler settings and NodeNext ESM semantics in the repository configuration.
- Follow Biome formatting: two-space indentation, double quotes, and organized imports. Do not add a competing formatter or linter.
- Give every exported item complete TSDoc with a realistic `@example`. Document observable behavior, and add concise documentation to non-obvious internal helpers.

## Established vocabulary

- `Errors<E>` is the explicit, type-only annotation for the injected readonly
  raisers. `E` is the exact map from codes to reason types.
- `PossibleErrors` is a result's error map; `AllPossibleErrors` adds the universal `UnexpectedError` branch.
- `ExpectedError` is the private native error used for declared raises. Keep it distinct from exported `UnexpectedError`.
- `ResultError` is the exact retained error passed to catch-all handlers, and `Fallback` is such a handler's output.
- Use `ErrorCode<PossibleErrors>` rather than bare `keyof` when a runtime code must be a string.
- Reserve “failure” for runtime failure results and their carrier, `FailureResult`.

## Load-bearing implementation rules

- Carry `E` through private declaration-only metadata on `Errors<E>`. Infer it
  from the wrapper's direct `(errors: Errors<E>, ...args)` parameter; do not add
  a separate validation parameter after inference. `Errors<E>` itself must
  reject the reserved `UnexpectedError` key and all numeric or symbol keys.
- Use one shared proxy prototype for every invocation context. Give each call a
  fresh ordinary object. Except for `UnexpectedError`, string reads create
  detachable raisers bound to that object. Symbol reads do not create raisers.
- Every context, including `Errors<{}>`, exposes the readonly universal
  `UnexpectedError(reason?: unknown): never` raiser. It must construct and
  throw the exported `UnexpectedError` directly. Keep it detachable and
  independent of invocation identity. Later wrappers from the same loaded copy
  must preserve the thrown instance and its raise-site stack.
- Use one normally constructed private `ExpectedError` for declared raises.
  Store the originating invocation object as its boundary identity. Compare
  that identity, never code strings, and preserve the native raise-site stack.
- At wrapper boundaries, preserve an existing `UnexpectedError`, accept only the current invocation's `ExpectedError`, and wrap every other thrown value once.
- Keep `unwrap` and `handle` as receiver-dependent, non-enumerable prototype
  methods shared by their result variant. Results remain mutable and
  extensible. Only failure instances retain failure state.
- `wrapAsync` must use native promise resolution and scoped rejection
  conversion so it recursively assimilates thenables. `wrapSync` must preserve
  returned values without reading a `then` property.
- A primary wrapper implementation always receives `Errors<E>` first, and the
  returned wrapper removes that parameter. Use `Errors<{}>` when it declares no
  codes. `.try` accepts a function with no context and exposes only
  `UnexpectedError`.
- Keep `.try` on its direct unexpected-only path. Do not route it through the
  primary wrapper, allocate an invocation context, or create an adapter
  function around the supplied function. Share async rejection callbacks when
  they retain no invocation state.

## Tests and changes

- Add or update public runtime and type tests for every behavior change.
  Runtime tests are `tests/*.test.ts`; type-only tests are `tests/*.test-d.ts`.
- Cover the relevant specification boundaries, including `Errors<E>` inference, dynamic raisers, invocation provenance, retained errors, malformed untyped handlers, result descriptors, and promise/thenable behavior.
- Keep timing assertions out of conformance tests. Benchmark allocation or dispatch changes separately and report the engine and result-shape assumptions.
- Do not add consumer or browser smoke fixtures unless requested. Keep generated output, temporary fixtures, dependencies, and benchmarks out of source control.
- Make the smallest coherent change. Run every verification command, then
  update `README.md` if observable behavior changed.

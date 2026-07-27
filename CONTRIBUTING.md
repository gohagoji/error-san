# Contributing

Start by sharing [`AGENTS.md`](./AGENTS.md) with your LLM coding assistant and
ask it to onboard you to the project. It covers the repository's constraints,
conventions, and expectations for changes.

[`SPEC.md`](./SPEC.md) is the source of truth for the public API and behavior.
Read the relevant sections before making a change; the
[`README.md`](./README.md) describes the implementation once it matches the
specification.

## Development

Development requires Node.js 22 or newer; Node.js 26.x is recommended. Use
the pnpm version declared in [`package.json`](./package.json).

Install dependencies:

```sh
pnpm install
```

Before considering a change complete, run:

```sh
pnpm lint
pnpm test
pnpm build
```

# Validation status

This source snapshot was prepared on September 17, 2026.

## Checks completed in the build environment

- `package.json` parses as valid JSON.
- All TypeScript / TSX source files plus `vite.config.ts` were syntax-transpiled with the available TypeScript compiler: **21 files, 0 syntax errors**.
- The project structure and provider adapters were reviewed against current provider API documentation.
- API keys are server-side only and the Express server binds to `127.0.0.1` by default.
- A synthetic `DEMO_MODE` adapter and a four-lane smoke-test script are included.

## Environment limitation

The build environment could not reach the npm registry: `npm install` timed out. As a result, this archive intentionally does **not** contain `node_modules` or a generated `package-lock.json`, and a full dependency-backed runtime/typecheck could not be executed here.

## Reproduce the runtime validation locally

```bash
npm install
# Copy .env.example to .env (Windows: copy .env.example .env)
# Set DEMO_MODE=true in .env
npm run dev
```

In another terminal:

```bash
npm run typecheck
npm run smoke
```

Then set `DEMO_MODE=false`, add only the provider keys you want to test, and run the same UI against real APIs.

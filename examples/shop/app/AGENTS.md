# API (app/)

The API is an Express app. `src/server.ts` wires the routes; every route lives in its own file under `src/routes/`.

## Rules for this folder

- A route validates its input with a `zod` schema before it does anything else.
- A route returns `{ data }` on success and `{ error: { code, message } }` on failure. Use the codes in `src/errors.ts`.
- A handler never reads `process.env`. Configuration comes from `src/config.ts`, which fails at start if a value is missing.
- Every database call is inside a transaction when it writes more than one row.
- Slow work (email, exports, image resizing) goes on the queue in `src/jobs/`, not in the request.

## Tests

- Route tests use `supertest` and the test database from `npm run db:test`.
- Do not mock the database. A test that does not touch it is a unit test of a pure function.
- Name a test after the behaviour, not the function: "refuses an order with no items".

## Checking your work

Run `npm test -- app` for this folder only, then `npm run lint`. If a migration changed, run `npm run db:reset` first.

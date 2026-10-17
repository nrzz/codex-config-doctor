# Shop

A small online shop: an Express API in `app/`, a React front end in `web/`, shared types in `shared/`.

## Commands

- `npm test` runs every test. Run it before you say a change is done.
- `npm run lint` must pass with no warnings. Fix the code, do not add an ignore comment.
- `npm run build` writes `dist/`. Never edit `dist/` by hand and never commit it.

## Conventions

- TypeScript everywhere. No `any`: use `unknown` and narrow it.
- One component per file, named like the file. Hooks live in `web/src/hooks/`.
- Money is an integer number of cents. Never use floating point for a price, a total or a discount.
- Dates are ISO 8601 strings in UTC. Convert to local time only in the view.
- SQL goes through the helpers in `app/src/db/`. Never build a query by joining strings.

## Pull requests

- Keep a change to one concern. A refactor and a fix are two pull requests.
- Add a test with every fix. The test must fail without the fix.
- Update `CHANGELOG.md` under "Unreleased" for anything a customer can see.

## Do not

- Do not touch `infra/`: it is owned by the platform team.
- Do not add a dependency without saying why in the pull request.
- Do not log a card number, a token or an email address.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

- Read `SPEC.md`, then `tasks/plan.md` (contracts, frozen files, rules for
  parallel agents), then your task in `tasks/todo.md`, before writing code.
- Only the coordinator edits `SPEC.md`, `tasks/`, `package.json`,
  `package-lock.json`, config files and the other frozen files listed in
  `tasks/plan.md`. If you need a change there, stop and report.
- Next.js 16: Cache Components are off (`next.config.ts`). There is no
  `middleware`; route protection is `requireUser()` in the `(app)` layout
  and in every server action and route handler.
- UI components in `src/components/ui/` are shadcn/ui built on Base UI, not
  Radix: there is no `asChild`; use the `render` prop, or `buttonVariants()`
  for links styled as buttons.
- Import the database client only as `import { db } from "@/db"`. Under
  Vitest that import is an empty in-memory Postgres (one per test file) with
  the real migrations applied, so integration tests need no setup.
- Shared enums and types are in `src/lib/domain.ts`; table definitions are in
  `src/db/schema.ts` (plural names: `users`, `courses`, `sheets`, …).
- In a page, load user data as `await orNotFound(requireSheet(user.id, id))`
  (`@/lib/auth/guards`): a missing or foreign id then shows the 404 page.
- Parallel agents share ONE browser and its cookies, and cookies ignore port
  numbers: signing in on `localhost:3001` signs out `localhost:3000`. Each agent
  opens its own dev server under its own hostname: the coordinator uses
  `http://127.0.0.1:3000` (allowed in `next.config.ts`), track agents use
  `http://localhost:<their port>`. Never sign in on another agent's hostname.
  Uploads go straight from the browser to R2, whose CORS rule only allows
  `http://localhost:3000` and `http://localhost:3003`; other origins fail with
  "Failed to fetch" on upload (not a bug in the code).
- Render any question, hint, solution or feedback text with `<MathText>`.
- Before reporting a task done: `npm run lint`, `npm run typecheck`, `npm test`.

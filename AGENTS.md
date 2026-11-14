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
- Render any question, hint, solution or feedback text with `<MathText>`.
- Before reporting a task done: `npm run lint`, `npm run typecheck`, `npm test`.

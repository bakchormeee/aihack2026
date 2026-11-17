# Spec Delta: OpenAI as an AI provider, and a cheaper model for easy calls

Status: approved (owner, 17 November 2026); being built.
Original spec: [SPEC.md](SPEC.md), "Tech stack" (row "AI") and "AI calls" ("The model id is read
from `AI_MODEL` (default `claude-sonnet-5-5`)"); [src/lib/ai/README.md](src/lib/ai/README.md).

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `ai-routing` | Each AI call picks its provider, model and effort from config; usage is logged per call | — |
| `ai-openai` | `callAi` can send a call to the OpenAI API instead of the Claude API | `ai-routing` |

Build order: `ai-routing` first (useful alone: it lets the cheap calls move to Claude Haiku 5.5
with no new provider), then `ai-openai`.

## Objective

Lower the AI bill. Two levers:

1. **Cheaper model for easy calls.** Short, text-only calls whose mistakes are low-harm run on a
   cheaper model; calls whose output is used to mark students stay on a strong model.
2. **OpenAI as a provider.** The app can use an OpenAI API key, per call, so the owner can use
   whichever provider is cheaper or already paid for, and move one call at a time.

## Current behaviour

- Every call goes through `callAi` (`src/lib/ai/client.ts`) to the Claude API, with one model
  (`AI_MODEL`, default `claude-sonnet-5-5`) and one effort (`AI_EFFORT`, default `medium`) for
  all ten calls.
- Token usage is not recorded anywhere.

## New behaviour

### 1. A route per call (`ai-routing`)

- A **route** is `{ provider, model, effort }`, with `provider` one of `anthropic` | `openai`.
- `src/lib/ai/routes.ts` holds the default route of each call, in two tiers:

  | Tier | Calls | Why |
  |---|---|---|
  | **strong** | `parseSheet`, `extractSolutions`, `markAttempt`, `matchWorking`, `generateHints`, `generateVariant`, `writeFlawedSolution` | Read PDFs or handwriting, or write the worked solution that marking is checked against |
  | **cheap** | `summariseSheet`, `judgeSpotAnswer`, `groupMisconceptions` | Short text-only jobs; a weaker answer is visible and low-harm |

- Each tier's model comes from config, so no model id is hard-coded in more than one place:
  - `AI_PROVIDER` (default **`openai`**; set `anthropic` to keep using Claude)
  - `AI_MODEL_STRONG`, `AI_MODEL_CHEAP`, `AI_EFFORT_STRONG`, `AI_EFFORT_CHEAP`
  - Defaults when unset: openai strong `gpt-6.2-sol` @ `medium` ($2 / $10 per 1M tokens),
    openai cheap `gpt-6-luna` @ `low` ($0.10 / $0.50); anthropic strong `claude-sonnet-5-5` @
    `medium`, anthropic cheap `claude-haiku-5-5` @ `low`.
- **Per-call override:** `AI_ROUTE_<callName>` (for example `AI_ROUTE_markAttempt=openai:<model>:medium`)
  replaces that call's route. A malformed value fails at the first call with a message naming the
  variable, never silently falls back.
- `AI_MODEL` and `AI_EFFORT` keep working for one release: when set, they apply to the strong
  tier when the provider is `anthropic` (they hold Claude model ids, which OpenAI would reject).
- **Switching the live site:** because the default is now OpenAI, `OPENAI_API_KEY` must be set
  in Vercel before this is deployed, or every AI call fails. To deploy without switching yet,
  set `AI_PROVIDER=anthropic` in Vercel first.
- **Usage log:** after every real request, one line is logged with call name, provider, model,
  effort, input, output and cache tokens, and whether it was the retry. No prompt text, no user id
  beyond what is logged today.

### 2. OpenAI provider (`ai-openai`)

- `callAi` keeps its signature. Behind it, a provider adapter turns the same `system`, `text`,
  `files` and Zod `schema` into a request for the route's provider:
  - **anthropic:** today's request, unchanged.
  - **openai:** the OpenAI Responses API through the official `openai` npm package: system
    prompt as instructions, files as PDF / image input parts before the text, structured JSON
    output from the Zod schema, effort mapped to OpenAI's reasoning effort, the same output
    token limit.
- Everything around the request is shared and unchanged for both providers: the Zod check and
  one retry, `AiOutputError`, `AiInputError` file limits, the demo AI budget (one reserved call
  per request), and fixture mode (`AI_FIXTURES=1` makes no request for either provider).
- A refusal or a reply cut off at the token limit is treated as an invalid reply, as it is now.
- `OPENAI_API_KEY` is read on the server only, like `ANTHROPIC_API_KEY`. A route to a provider
  whose key is not set fails with a clear error at the first call.
- Every Zod schema in `src/lib/ai` must be accepted by OpenAI's strict structured output. Where a
  schema needs reshaping for that (for example optional fields), the reshaping happens in the
  adapter, and the module's own output type does not change.

### 3. Quality check before switching the live site

- `scripts/compare-ai.ts` runs a fixed set of about 20 real inputs (demo-template questions,
  sheets and working photos, chosen with the owner) through two routes and writes the outputs
  side by side, with tokens and cost per call, to a local HTML or Markdown file for the owner to
  read. It costs real API money: it prints the estimated cost and asks before it runs.
- The live site's routes change only after the owner has read that comparison.

## Success criteria

- With no provider set, every call goes to OpenAI with its tier's model.
- With `AI_PROVIDER=anthropic` and no other new variables, every strong-tier call sends the same
  request as today (a test compares the request body for each call name with the current one).
- Each call name resolves to the route in the tier table; `AI_ROUTE_<callName>` overrides one
  call and no other; a malformed value throws with the variable's name.
- With a fake OpenAI client, each call's request has the right model, effort, file parts and
  JSON schema, and a valid reply returns the same typed result as the Claude path.
- Invalid OpenAI JSON is retried once and then throws `AiOutputError`; a refusal and a cut-off
  reply count as invalid; the demo budget counts each request.
- Every schema in `src/lib/ai` converts to an OpenAI strict schema (one test per call name).
- One usage line is logged per real request, for both providers.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e` pass; e2e still runs on
  fixtures and makes no real call.

## Boundaries (deltas only)

- **Always:** keep `callAi` the only place that imports an AI SDK. Keep model ids in config and
  `routes.ts`, nowhere else.
- **Ask first:** running `scripts/compare-ai.ts` or any real call (it costs money); changing the
  live site's routes or keys in Vercel.
- **Never:** call a real AI API from automated tests; send an API key to the browser; log prompt
  text, student work or answers.

## Out of scope (deferred)

- Other providers (Gemini, self-hosted models): the adapter makes them possible later.
- Automatic fallback to the other provider when one fails or refuses.
- The Batch API, reusing AI work for duplicate sheets, PDF text extraction, embeddings for
  grouping errors: separate cost levers, each its own change.
- Choosing the route at run time by question difficulty.

## Open questions

1. ~~OpenAI model ids and prices.~~ Answered from OpenAI's pricing page (17 November 2026): strong
   `gpt-6.2-sol`, cheap `gpt-6-luna` (see "A route per call"). `gpt-6.2-astra` ($8 / $40) costs
   more than Sonnet and is not a default.
2. **PDF and handwriting quality on OpenAI.** Parsing sheets and reading handwritten working are
   the riskiest calls to move; the comparison run should include them before they move.
3. **Privacy.** Student working would go to OpenAI as well as Anthropic. The app has no privacy
   page naming either provider today; decide whether one is needed before using real students'
   work.

Decided: the default provider is OpenAI (owner, 17 November 2026). Claude stays available with
`AI_PROVIDER=anthropic` or a per-call route.

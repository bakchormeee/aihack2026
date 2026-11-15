# AI calls (`src/lib/ai`)

All Claude API use goes through `callAi` in `client.ts`. The modules beside it
(`parse-sheet.ts`, `generate-hints.ts`, …) hold one prompt and one Zod schema
each. They take file bytes (`AiFile`) and never touch storage or the database.

Facts below were read from the Claude API documentation on 14 November 2026
(Messages API, vision, PDF support, structured outputs) and from the installed
SDK, `@anthropic-ai/sdk` 1.8.0. **No real call has been made yet**: there was
no API key when this was written. Run `scripts/try-ai.ts` once a key exists.

## Model

- Model id: read from `AI_MODEL`; default **`claude-sonnet-5-5`** (1M context,
  128K maximum output). Model ids are used as written, with no date suffix.
- Thinking: adaptive and always on for this model. `callAi` sends no
  `thinking` field (`{type: "disabled"}` and `budget_tokens` return a 400).
- Effort: `output_config.effort`, read from `AI_EFFORT`, default `medium`
  (the API default is `high`; `medium` is used for speed). Values: `low`,
  `medium`, `high`, `xhigh`, `max`.
- `max_tokens`: read from `AI_MAX_TOKENS`, default 16000. Requests are not
  streamed; 16000 keeps a non-streamed request inside the SDK's timeout.
- Not sent, because this model rejects them: `temperature`/`top_p`/`top_k`,
  an assistant prefill, forced `tool_choice`.
- If `AI_MODEL` is set to another model, check that it supports
  `output_config.effort` and `output_config.format` (Haiku 4.5 rejects
  `effort`).

## Input limits

| Input | Limit found | What `callAi` does |
|---|---|---|
| Whole request | 128 MB on the first-party API | Nothing; the limits below are reached first |
| PDF | 600 pages per request (100 for models with a context window under 1M); no password or encryption; each page is sent to the model as extracted text plus an image, about 1,500–3,000 text tokens per page plus the image tokens | Sends a base64 `document` block; rejects a PDF above 32 MB with `AiInputError` |
| Image types | `image/jpeg`, `image/png`, `image/gif`, `image/webp` only | Any other type (for example HEIC) throws `AiInputError` before a request is made |
| Image size | 10 MB per image, measured on the base64 text (about 7.5 MB of file); 8000 × 8000 px maximum | Throws `AiInputError` above 10 MB |
| Image count | 600 per request; above 20 images in one request every image must be at most about 3,000 px on each side | Nothing. Callers should send at most 20 files in one call |
| Image cost | `⌈width / 28⌉ × ⌈height / 28⌉` tokens | Nothing. The browser resizes photos before upload (SPEC) |

Files are placed before the text in the user message, in the order given.
A PDF is `{type: "document", source: {type: "base64", media_type:
"application/pdf", data}}`; an image is `{type: "image", source: {type:
"base64", media_type, data}}`.

## Structured output

- Method: **JSON outputs**, `output_config: { format: { type: "json_schema",
  schema } }` on `client.messages.create`. The schema is produced from the Zod
  schema by `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`, which
  removes constraints the API does not support. The old top-level
  `output_format` field is deprecated and not used.
- The API guarantees that the reply is JSON of the right shape. It does **not**
  enforce numeric ranges, string lengths or array lengths, so `callAi` always
  validates the reply again with the full Zod schema.
- Schema rules that shape the modules: every object is closed
  (`additionalProperties: false`), no recursive schemas, no
  `minimum`/`maximum`, no `minLength`/`maxLength`, no tuple or length
  constraints on arrays. For that reason the three hints are three named
  fields (`hint1`, `hint2`, `hint3`) in the schema and become the
  `[string, string, string]` of contract C2 in the module.
- The first request with a new schema is slower (the schema is compiled and
  then cached for 24 hours).
- A reply with `stop_reason` `refusal` or `max_tokens` is treated as invalid
  output.

## Behaviour of `callAi`

1. Fixture mode: with `AI_FIXTURES=1`, returns
   `tests/fixtures/ai/<callName>.json` (path relative to the working
   directory), validated with the schema. No client is created and no request
   is made.
2. Otherwise sends one request. If the reply is not valid for the schema, it
   sends the request once more with the reason appended. A second invalid
   reply throws `AiOutputError` (`error.callName` names the call).
3. API errors (`Anthropic.APIError` and subclasses) are not caught. The SDK
   retries 408, 409, 429 and 5xx responses twice by default.
4. A file the API cannot accept throws `AiInputError` before any request.

Server-side refusal fallback (`fallbacks`, a beta feature) is **not** enabled:
it needs the beta endpoint and could not be checked without a key. A refusal
is unlikely for mathematics; if one happens it surfaces as `AiOutputError`.

## Tests

`setAiClient(fake)` replaces the API client; `setAiClient(null)` restores it.
Unit tests never reach the network. Each module has two fixtures in
`tests/fixtures/ai/`: `<callName>.json` (valid, used by fixture mode) and
`<callName>.invalid.json` (must be rejected by the schema). Every fixture
contains LaTeX with backslashes.

## Manual check

```bash
npx tsx scripts/try-ai.ts generateHints input.json
```

`input.json` is the module's input. In a `files` array write each file as
`{ "path": "sheet.pdf" }`.

## Call names

`parseSheet`, `generateHints`, `markAttempt`, `extractSolutions`,
`generateVariant`, `summariseSheet`, `matchWorking`.

## Module notes for callers

- `parseSheet` makes topic names consistent before it returns: a topic that
  matches an existing topic in any letter case takes the existing spelling
  and is not listed in `newTopics`; every other topic a question uses is
  listed in `newTopics` (with `parent: null` if the model did not declare it).
  A `parent` or prerequisite may be a name that is in neither list; create it.
- `generateHints` and `generateVariant` regenerate once when hint 1 or 2
  contains the final answer, and return the second result even if it still
  leaks. `hintsLeakAnswer` compares text after normalising spacing and a few
  LaTeX spellings; it cannot see an answer written in a different but equal
  form.
- `markAttempt` returns no outcome. For a score of 100 it sets `errorType`
  and `firstWrongStep` to `null`. The prompt tells the model not to state the
  final answer in feedback, because the solution may still be locked.
- `extractSolutions` requires the model to answer for every question id
  (a missing, unknown or repeated id is invalid output). A question whose
  solution is not in the document is **left out of the result**, so
  `solutions` can be shorter than `questions`. In fixture mode the fixture
  solutions are given to the caller's questions by position.
- `summariseSheet` and `extractSolutions` return empty results without a
  request when given no items or no questions.

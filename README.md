# Problem Pal

**Learn from your mistakes. Then learn to spot them.**

Problem Pal is an AI maths companion for university students working through weekly problem
sheets. It was built for the Reply Student Tech Clash 2026, AI on Campus (London).

- **Live app:** https://aihack2026-lyart.vercel.app (open `/demo` to try it without signing in)
- **Specification:** [SPEC.md](SPEC.md), plus the feature specs `SPEC-*.md`
- **Project story:** [The problem, learning science and our approach](docs/PROJECT_STORY.md)

## Why we built it

Following a worked solution is different from being able to solve the problem independently.
Mistakes get scattered across sheets, and exam revision can become redoing everything without
a clear picture of what needs practice.

Problem Pal connects those moments: **attempt → guidance → understand mistakes → targeted
practice → spaced review**. Its Spot the Error mode turns likely misconceptions from your own
attempts into new worked solutions for you to evaluate and explain.

The design draws on research into retrieval practice, spaced practice and self-explanation.
It aims to make study time more purposeful; learning gains and time savings still need
evaluation with students. That is our answer to AI on Campus: help students think by keeping
them responsible for attempting, explaining and challenging the reasoning.

[Read the full story and research references →](docs/PROJECT_STORY.md)

## What it does

1. **Upload a problem sheet** (PDF or photo). The AI splits it into questions and topics.
2. **Attempt a question** with typed working, photos or a PDF. Three hints get stronger one
   at a time, and the worked solution unlocks only after a real attempt.
3. **Get marked.** The AI gives a score out of 5 and marks each mistake on your working. It
   tells careless slips apart from mistakes in the method. You can dispute a mark, and the
   AI re-marks against official solutions once those are uploaded.
4. **Remember your mistakes.** The app groups your mistakes into likely recurring
   misconceptions, estimates your mastery of each topic and schedules spaced reviews.
5. **Spot the error.** The AI writes new worked solutions that contain *your own* typical
   mistakes. You find the wrong line and explain why it's wrong. Some solutions have no
   error, so you have to check the reasoning instead of assuming there's always a mistake.

## APIs, models and datasets

### AI models

| Model | Provider | Used for |
|---|---|---|
| `claude-sonnet-5-5` (default; change it with `AI_MODEL`) | Anthropic Claude API, Messages API with JSON structured outputs, vision and PDF input | Reading sheets, summarising sheets, hints, marking, extracting official solutions, grouping misconceptions, new question variants, spot-the-error solutions, judging spot-the-error answers. All calls go through [`src/lib/ai/client.ts`](src/lib/ai/client.ts); see [`src/lib/ai/README.md`](src/lib/ai/README.md). |
| `scribe_v2` (change it with `ELEVENLABS_STT_MODEL`) | ElevenLabs Speech to Text | Students can say what is wrong in spot the error instead of typing it. *On branch `feat/spot-voice-input`.* |
| ElevenLabs Sound Effects | ElevenLabs | Made the interface sounds in `public/sfx/` once, ahead of time. The running app doesn't call it. *On branch `feat/spot-voice-input`.* |

### APIs and services

| Service | Used for | Settings |
|---|---|---|
| Anthropic Claude API | All AI features above | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EFFORT`, `AI_MAX_TOKENS` |
| ElevenLabs API | Speech to text (server side only; the key never reaches the browser) | `ELEVENLABS_API_KEY` |
| Neon (Postgres) | Database: users, courses, sheets, attempts, marks, mastery, review dates | `DATABASE_URL` |
| Cloudflare R2 (S3-compatible) | Uploaded sheets, working and solutions; the browser uploads straight to R2 with presigned URLs | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Google OAuth (Auth.js) | Sign-in | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| Vercel | Hosting, plus a preview deployment for every branch | |
| Google Fonts (via `next/font`) | Geist, Geist Mono, Source Serif 4 | |

### Datasets

- **No external or public dataset is used, and no model is trained or fine-tuned.** The app
  adapts to each student from their own recorded attempts, hints, marks and mistakes, which
  are stored in their account.
- **Demo data:** the `/demo` account was built by [`scripts/build-demo.ts`](scripts/build-demo.ts).
  It ran the real pipeline and AI on sample problem sheets from three courses (Numbers,
  Analysis I, Sequences and Series). Those sheets are not stored in this repository.
- **Test fixtures:** [`tests/fixtures/ai/`](tests/fixtures/ai) holds recorded AI responses, so
  the tests run without calling the API (`AI_FIXTURES=1`).

### Main libraries

Next.js 16, React 19, TypeScript, Auth.js, Drizzle ORM, Zod, shadcn/ui on Base UI, Tailwind
CSS, KaTeX (maths), Recharts and D3 (charts and skill map), pdf-lib, Vitest and Playwright.
The full list is in [`package.json`](package.json).

## Running it locally

```bash
npm install
cp .env.example .env.local   # fill in the keys above
npm run db:migrate
npm run dev                  # http://localhost:3000
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e`.

## Limits

- AI marks and misconception labels are suggestions to help practice, not official grades.
- Generated maths (hints, variants, flawed solutions) can contain unintended errors.
- Your work is sent to Anthropic for AI processing, and spoken answers to ElevenLabs.

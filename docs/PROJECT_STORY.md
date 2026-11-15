# Problem Pal: the project story

**Turn your maths mistakes into personalised practice, spaced revision and challenges that make you think.**

[Try the demo](https://aihack2026-lyart.vercel.app/demo) · [Project overview and setup](../README.md) · [AI on Campus challenge](https://studentclash.reply.com/challenges/AI_on_Campus_LONDON.html)

## Inspiration

Understanding a solution when you read it is different from being able to solve the problem yourself.

We built Problem Pal for university students working through weekly maths problem sheets. When you get stuck, it is tempting to open the full solution. You can follow every step and feel ready to move on, without checking whether you could reproduce the reasoning independently.

Meanwhile, mistakes accumulate across handwritten sheets and PDFs. By exam season, students face two difficult questions: what do I actually need to practise, and when should I revisit it? Redoing every question takes time; returning only to familiar material can leave important gaps untouched.

We wanted each sheet to become a continuous learning loop:

Attempt → receive guidance → understand mistakes → revisit weak topics → test your reasoning again.

That connects directly to the AI on Campus challenge: does AI help someone think, or think for them? Problem Pal uses AI to organise practice, offer graduated support and challenge students to explain the reasoning themselves.

## What it does

Problem Pal turns your own problem sheets and mistakes into personalised practice.

Students upload a maths sheet as a PDF or photos. The app separates it into questions and subparts, tags their topics and records attempts. It works in a phone browser, so students can photograph handwritten working as well as submit PDFs or typed LaTeX.

### 1. Guidance that keeps you thinking

Students can reveal three progressively stronger hints: a nudge towards the relevant concept, an approach, and a skeleton with the computations left out.

AI marking provides a score out of five and boxes identified mistakes in the student's own working: red for structural errors and amber for careless slips. Feedback directs attention to what needs checking, encouraging another attempt.

The worked solution unlocks after a successful attempt or after all three hints have been revealed. Access is enforced on the server. There is also a review pathway for submitted attempts when official solutions have been uploaded.

### 2. AI that adapts practice from your mistakes

Problem Pal groups errors from previous attempts into likely recurring misconceptions. Our proudest feature, Spot the Error, uses those misconceptions to generate new worked solutions containing deliberately planted mistakes.

Students identify the faulty lines and explain why they are wrong before seeing the feedback and correction. Some exercises contain no planted error, so they must evaluate the reasoning rather than assume every solution is flawed.

For example, a student who repeatedly misapplies the product rule can encounter that misconception in a new worked example. They move from making the mistake to recognising and explaining it.

The distinctive contribution is the connection: a student's submitted mistakes shape their next reasoning challenge, and the results feed back into their learning record.

### 3. Revision that knows where to focus

A topic-level mastery estimate uses recorded outcomes and hint use. A correct answer reached independently contributes differently from one reached with substantial support.

Revision sessions combine previous questions with newly generated variants. Each item explains why it was selected. Performance-dependent spaced review schedules organise later practice, while a visual skill map shows topic history and estimated mastery.

When official solutions become available, students can upload them for AI re-marking of attempts with matched reference solutions. Changed marks are flagged. These remain AI judgements against an official reference, rather than official grades.

### The learning science behind it

Problem Pal brings research-supported approaches into the materials students already use.

Retrieval practice — attempt before reviewing. Research has shown that retrieving material can improve delayed retention compared with additional studying. Problem Pal creates opportunities to attempt questions and revisit them with hints initially hidden. This evidence motivates the design; it does not establish a measured benefit for our university maths workflow. [Roediger and Karpicke, 2006](https://pubmed.ncbi.nlm.nih.gov/16507066/)

Spaced practice — revisit across days. Research shows that the timing of review affects later retention. Problem Pal uses an SM-2-style topic scheduler to organise practice over time. The evidence supports spacing; it does not establish that our particular schedule is optimal for university maths. [Cepeda et al., 2008](https://pubmed.ncbi.nlm.nih.gov/19076480/)

Self-explanation and error analysis — explain why a step fails. Mathematics-education research has investigated learning through correct and incorrect worked examples with self-explanation prompts. Spot the Error applies this approach to misconceptions drawn from a student's own history. Its effectiveness depends on the quality of the examples, feedback and support. [Booth et al., 2013](https://www.sciencedirect.com/science/article/pii/S0959475212000904)

### How it makes revision more efficient

Problem Pal is designed to make limited study time more purposeful:

- Less manual organisation: sheets, attempts and mistakes become a connected learning record.
- More targeted practice: recorded weaknesses and hint dependence help prioritise what to revisit.
- More use from each mistake: one error informs feedback, future exercises and later review.
- Practice beyond a remembered answer: new variants create opportunities to apply a technique in a different setup.

Our goal is better independent performance for the time spent studying. We have not yet measured time savings or learning gains. The prototype is built around evidence-backed methods; its educational impact still needs evaluation with students.

## How we built it

We built a responsive web app using Next.js 16, React 19 and TypeScript, with Neon Postgres through Drizzle, private file storage on Cloudflare R2, and Auth.js for Google sign-in.

Claude powers sheet parsing, hints, marking, official-solution extraction, misconception grouping, variant generation, summaries and Spot the Error exercises. Outputs are checked against Zod schemas, with retry handling for invalid responses.

Permissions, solution access, scoring rules and revision scheduling are controlled in application code. Mastery estimates are recomputed from recorded attempts, so marking changes can flow through to revision priorities. These estimates guide practice; they are not a certification of understanding.

We worked from a shared specification and built the core learning loop before adding later features. Separate AI coding agents implemented modules against the shared plan. Automated tests check rules and workflows; they do not establish learning outcomes or live AI accuracy.

## Challenges we ran into

AI feedback can be wrong. Handwriting can be misread and valid alternative methods rejected. We label marks without an official reference as provisional, support limited disputes and allow re-marking against uploaded official solutions. Even reference-based AI marking can be wrong.

Helpful hints can reveal too much. We introduced graduated hints and checks for answer leakage. These reduce a known failure mode, but do not guarantee that every hint preserves the intended challenge.

Error-spotting needs trustworthy examples. Structural checks validate output formats and line references, but cannot establish mathematical correctness. Reviewing generated exercises for unintended errors is an important part of further evaluation.

Different mistakes need different treatment. We moved from a percentage scale to a five-point scheme that distinguishes structural misunderstandings from careless slips.

Personalisation must be understandable. Revision items explain why they were selected, so students can see the evidence behind a recommendation.

## Accomplishments that we're proud of

Revision that knows where to focus. Recorded attempts become topic priorities and scheduled reviews.

AI that adapts practice from your mistakes. A misconception identified in previous work can become the basis of a new exercise.

AI that makes students think. Graduated hints, targeted feedback and explanation-based error spotting keep the student actively involved.

Our strongest achievement is connecting these features: the mistakes a student makes today can shape the reasoning they learn to challenge tomorrow.

## What we learned

The key design question was what the student should do after receiving AI feedback. Showing a correction completes an interaction. Asking the student to retry, explain an error or apply a technique creates another opportunity to learn.

We also learned to distinguish software correctness from educational effectiveness. Automated tests can verify scheduling rules, permissions and recorded state. Demonstrating improved understanding requires evaluation with students.

Writing down the rules first helped us coordinate implementation and keep the behaviour consistent across the learning loop.

## What's next for Problem Pal

We want to pilot Problem Pal within one university maths module and evaluate:

- Performance on unseen questions, immediately and after a delay, using comparison groups with similar study time.
- Tutor agreement with AI marking and misconception labels.
- Mathematical correctness of generated exercises and the frequency of answer leakage in hints.
- Whether students can complete useful practice within a fixed study period.
- Accessibility across devices, input methods and different learning needs.

Our initial focus is formative maths practice. Students who rely on handwriting recognition, assistive technology or unreliable internet may face additional barriers, which need testing with users. Expansion to other quantitative subjects would require subject-specific validation.

Problem Pal helps students turn their own mistakes into a plan for what to practise—and a challenge to explain why.

# Problem Pal
## Learn from your mistakes. Then learn to spot them.
AI on Campus · Student Tech Clash London · Revised project description

### Project description
Problem Pal turns university maths problem sheets into a personalised learning loop: attempt a question, receive graduated hints and feedback, revisit weak topics, and learn to recognise flawed reasoning independently.

The initial user is a university maths student working through weekly practice sheets. When they get stuck, the usual choices are to keep struggling or read a complete solution. Neither tells them whether they can solve a similar problem independently a week later. At exam time, their old mistakes are scattered across sheets, with little guidance on what to revisit.

Our web app brings those moments together. Students upload a problem sheet, work through its questions, and submit typed working, photos or PDFs. Three progressively stronger hints support independent attempts. AI marking gives a score out of five and identifies mistakes in the student's working, with feedback aimed at helping them make the next correction.

The platform uses attempt history, hint use and outcomes to estimate topic mastery and prioritise revision. Spaced review schedules topics for later practice; revision sessions include retries and newly generated variants. These estimates guide practice rather than certify ability.

Its distinctive feedback loop is Spot the Error. The system groups mistakes from the student's previous attempts into likely recurring misconceptions, then generates worked solutions containing selected examples of those errors. Students identify faulty lines and explain why they are wrong. Some exercises contain no planted error, so success requires evaluating the reasoning rather than assuming that every solution is flawed.

When official solutions become available, students can upload them for AI re-marking and review changed results. The reference improves the basis for feedback; it does not turn an AI judgement into an official grade.

The aim is to help students use AI to develop their own reasoning and critical judgement. Whether this improves retention and independent performance is a question for evaluation, not a result we have already established.

### One-sentence pitch
An AI maths companion that turns your problem-sheet mistakes into targeted revision and personalised exercises where you must challenge the solution yourself.

---

## A concrete student journey
### From making a mistake to recognising it independently
Illustrative scenario, not a measured user outcome: a student differentiates a product by multiplying its two derivatives, instead of applying the product rule.

1. Attempt: the student uploads a weekly calculus sheet and submits their working for a question.
2. Understand: the marker identifies the faulty step and provides a hint that directs attention to the product rule. The student can retry with progressively stronger support.
3. Remember: the mistake becomes evidence for a likely misconception. The student's topic history helps prioritise future practice.
4. Challenge: Spot the Error presents a new worked solution containing that misconception. The student must select the incorrect line and explain the error before seeing the reveal and correction.
5. Revisit: the answer contributes to the learning record, and the topic's review schedule adjusts according to recorded performance.

The demonstration should show these transitions in the actual interface. Use an account with prior attempts so the personalisation is visible, and show the source mistakes behind the exercise.

### What makes the project distinctive
Personalisation grounded in the student's own work. The exercise is linked to mistakes recorded in their course, rather than generated from a generic topic request.

A change in the student's role. They move from producing a solution to judging one, explaining why a plausible step fails. Including correct solutions also tests whether they can recognise valid reasoning.

A persistent learning loop. Hints, marking, misconception grouping, targeted practice and review scheduling use the same learning history. The value is in the connection between these steps.

### Why AI is useful here
AI interprets varied problem sheets and student working, proposes feedback, groups related mistakes and writes new exercises tailored to those mistakes. Maintaining that range of personalised content manually would require substantial authoring effort. Scheduling, permissions, solution unlocking and outcome rules remain application logic rather than decisions left entirely to a prompt.

### A defensible originality claim
The challenge itself suggests adaptive practice and adversarial reverse-testing. Do not present error-spotting alone as a new invention. Present the contribution as their integration: a student's own submitted mistakes become the material for later critical-reasoning practice, with the results feeding back into revision priorities.

---

## Fit with AI on Campus
The project addresses learning and formative assessment, with university maths practice as its initial scope. Levels 1 and 2 are required; Level 3 is an optional bonus. The repository's web application most closely matches Level 2, Track A: Full-stack engineering. This is a fit assessment, not confirmation of the team's registered implementation track.

### Originality · 30%
Show the personalised mistake-to-exercise loop. Explain how a recorded error changes the next learning activity. A generic AI-generated question is weaker evidence than an exercise visibly tied to the student's history.

### Relevance to the Theme · 20%
Anchor the problem in one recognisable moment: a maths student gets stuck on a weekly sheet and later repeats the same mistake. Show how hints support an attempt and how error analysis requires the student to reason independently.

### Potential Industry Application · 20%
Start with a pilot in one university maths module. A plausible route is use as a formative learning supplement alongside existing teaching. Expansion to other quantitative subjects would need subject-specific validation. Institutional integrations, tutor dashboards and commercial demand are future possibilities, not established capabilities or traction.

### User Experience & Design · 15%
Demonstrate one coherent journey from uploaded sheet to feedback to targeted revision. Make mathematical notation, annotated working, progress and next actions easy to read. Show the phone layout for photographed working, and clearly distinguish loading, failure and completed states.

### Presentation · 10%
Use a five-minute slide presentation, as required by the challenge. Lead with the student's problem, demonstrate the personalised loop, explain the safeguards and finish with a concrete evaluation plan. Keep a recorded walkthrough available as a demo backup.

### Security & Resilience · 5%
Explain the ownership checks around student records and files, and show what happens when AI processing fails. Be explicit that marking and inferred misconceptions can be wrong. Describe the actual data flow to external AI and storage services; avoid claiming comprehensive privacy compliance without evidence.

### Who benefits, and who could be left out?
The initial beneficiaries are students practising university maths, especially those who struggle to decide what to revisit. Handwriting recognition, mathematical notation, English-language explanations, connectivity and device access may create barriers. Typed working offers another input route, but accessibility and recognition quality still need testing with students. Timing-based signals should be examined for their effect on students who work more slowly or use assistive technology.

---

## What the repository supports—and what to verify
Implementation review of the public main branch on 15 November 2026. “Implemented” below means code paths were inspected; this review did not run the app or its tests, verify deployment configuration, or establish live model accuracy.

### Implemented in the inspected code
- Three-level hint generation, stored worked solutions and state-based solution unlocking.
- Marking pipelines, a score out of five, mistake records, misconception grouping and re-marking against uploaded official solutions.
- Topic review scheduling with performance-dependent intervals, plus revision-session generation.
- Spot the Error session generation from ranked misconceptions, answer validation, explanation judging, reveal and outcome recording.
- Ownership-check helpers and automated test files covering core rules and user journeys, including Spot the Error.

The original description's “planned” label for Spot the Error and “being implemented” label for spaced repetition are therefore outdated relative to the inspected code. Describe them as implemented in the prototype, with live behaviour still to verify before presenting.

### Priority checks before presenting
1. Run the complete personalised loop with real AI calls. Existing end-to-end tests include recorded AI responses; their presence does not establish the quality of live generation or marking.
2. Check the Track A streaming requirement. The inspected AI client uses non-streamed requests, and the UI refresh component polls for background results. This supports an interactive workflow but is not evidence of streaming APIs or WebSockets. Implement or demonstrate the required streaming connection before claiming full coverage.
3. Demonstrate context-dependent guardrails. The solution lock has explicit application rules, but hint leakage and prompt injection need further verification. The hint generator uses a text-based leak check and a regeneration attempt; this is not a guarantee that hints never reveal answers.
4. Check mathematical validity. Generated error exercises need review for unintended errors, valid alternative methods and correct answer keys. Schema and line-reference checks establish structure, not mathematical truth.
5. Demonstrate failure recovery, ownership enforcement and retained state. Verify them in the deployed prototype, including after a failed AI call or page refresh.

### Keep these claims precise
“Adapts practice from your recorded attempts” is supported more directly than “self-improving AI”. The code uses changing learner records; this review found no basis to claim that the underlying model retrains itself.

“Likely recurring misconceptions” is more accurate than a guaranteed diagnosis. “AI-marked against official solutions” is more accurate than an officially confirmed mark. Model confidence or mastery estimates are not measurements of a student's subjective confidence.

Do not claim the optional Level 3 multi-agent harness solely because the app has separate AI functions. Specialised calls and pipelines do not establish autonomous multi-agent orchestration or a human-expert escalation workflow.

---

## Five-minute presentation and evaluation
### Suggested presentation sequence
0:00–0:40 · The problem. Introduce the student and the moment they become stuck. Show why reading the answer leaves uncertainty about understanding.

0:40–1:20 · Guided attempt. Show a sheet, the student's working, graduated hints and targeted feedback.

1:20–2:50 · The distinctive loop. Show a recorded misconception, start Spot the Error, identify a flawed line and explain it, then reveal the feedback. Explain why some exercises contain no planted error.

2:50–3:35 · Revision over time. Show how the recorded results inform weak-topic priorities and spaced review. Briefly show how official solutions can change the feedback basis.

3:35–4:20 · Trust and limitations. Show solution-access rules, provisional marking and failure handling. Acknowledge the need to validate generated mathematics and test hint leakage.

4:20–5:00 · Evidence and next step. State what is working in the demo, what remains unverified and how a small module pilot would test independent learning.

### How we would know whether it works
Learning: compare performance on unseen, unaided questions immediately and after a delay. Include both solving problems and recognising flawed reasoning. Use a comparison condition such as ordinary revision or generic AI assistance, with comparable study time.

Feedback quality: have a maths tutor review a sample of marks, misconception labels and generated exercises. Measure marking agreement, unintended errors and incorrect rejection of valid methods.

Guardrails and reliability: measure hint-answer leakage under adversarial inputs, successful completion of the main workflow, latency, failure recovery and AI cost per completed session.

Usability and inclusion: observe students completing the journey on laptop and phone, using typed and photographed working. Record where recognition, notation or navigation blocks progress.

These are proposed evaluation measures. No learning improvement, accuracy percentage, user adoption or cost result is claimed in this description.

### Closing line
We turn the mistakes students make today into the reasoning they can challenge tomorrow.

### Sources and review scope
Challenge brief, scoring weights and presentation requirements: https://studentclash.reply.com/challenges/AI_on_Campus_LONDON.html
Project repository: https://github.com/bakchormeee/aihack2026
Code inspected: src/lib/pipeline/{mark,remark,hints,misconceptions,revision,spot-session,spot-answer}.ts; src/lib/spaced/review.ts; src/lib/marking/rules.ts; src/lib/ai/{client,generate-hints,write-flawed-solution}.ts; src/lib/auth/{guards,ownership}.ts; src/components/auto-refresh.tsx; tests/e2e/spot-the-error.spec.ts.
The repository's initial SPEC.md and AI README contain historical status statements. Feature wording above follows the inspected implementation where those documents differ. The repository may change after this review.

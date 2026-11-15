# Spec Delta: Uploading working for several questions at once

Status: approved 15 November 2026.
Original spec: [SPEC.md](SPEC.md), section "`attempts`" ("Uploading one file for the whole
sheet and matching pages to questions automatically is deferred") and the upload rules in
"`sheets`" (images resized in the browser, direct upload to storage). Marking is as in
[SPEC-marking-v2.md](SPEC-marking-v2.md). The AI limit of a demo copy is as in
[SPEC-demo.md](SPEC-demo.md).

## Objective

A student who has worked through several questions on paper photographs the pages once
and uploads them from the sheet page. The app works out which part of which photo answers
which question, the student checks that, and every matched question is then submitted and
marked. They no longer open each question to attach its own photo.

## Current behaviour

- Working is attached one question at a time, on the question's own page: up to 10
  images, or one PDF, or typed text.
- "Submit all" on the sheet page submits the questions that already have a draft.
- A photo that holds working for two questions must be uploaded twice, once on each
  question's page.

## New behaviour

### 1. Uploading

- The sheet page has a button **Upload working for several questions**. It accepts up to
  10 photos (JPEG, PNG or WebP), by file picker, camera or drag-and-drop. PDFs are not
  accepted here.
- The photos are resized in the browser and uploaded as today. They are kept only until
  the student confirms or cancels.

### 2. Matching (the AI proposes)

- One AI call (`matchWorking`) gets the photos and the sheet's question labels and bodies.
  For each question it finds, it returns one or more **regions**: a photo and a box on it.
  A question's working may continue on another photo or in another place on the same
  photo, so a question can have several regions, in reading order.
- The AI matches by the question numbers the student wrote ("3", "Q4(a)") and, when a
  number is missing, by what the working is about. It reports working it cannot place
  as **unmatched** instead of guessing.
- Only questions that can take working are matched: a question whose latest attempt is
  already submitted, and a sheet that is not ready, are left out and listed as skipped.

### 3. Checking (the student confirms)

- A review screen lists each matched question with its cropped regions, in order, and
  the unmatched regions at the end. Nothing is submitted yet.
- For each region the student can: move it to another question, remove it, or adjust its
  box by dragging the corners. They can also draw a new box on a photo and give it to a
  question, for working the AI missed.
- **Submit and mark** is enabled when at least one question has a region. **Cancel**
  discards everything and deletes the uploaded photos.

### 4. Submitting

- On confirm, the browser crops each region out of its photo and uploads the crops. Each
  matched question gets its crops, in order, as the images of its working (at most 10
  for one question). Typed text or files already in that question's draft are kept, and
  the crops are added after them.
- Every matched question is then submitted and marked, exactly as "Submit all" does
  today: the mark, the boxed mistakes on each crop, disputes and re-marking are unchanged.
- The student lands on the sheet page, where marks appear as they finish.
- Hints already revealed and the timer of an open attempt count as usual. A question
  with no open attempt gets a new one with no hints revealed and no time recorded.
- The full photos are deleted after the crops are saved.

### 5. Limits and failures

- If the AI finds nothing, the review screen says so and the student can draw the boxes
  themselves or cancel.
- If matching fails, the student sees "The photos could not be read. Try again, or attach
  working on each question." and nothing is changed.
- In a demo copy the matching call counts as one AI call and each mark as one more. If
  the copy has fewer calls left than the matching call plus one mark for each matched
  question, the action is refused before it starts, with the demo limit message.

## Success criteria

1. From the sheet page, 2 photos holding working for 4 questions lead to a review screen
   with 4 questions, each with the right crops in order, including one question whose
   working runs over two photos.
2. Moving a region to another question, removing one, adjusting a box and drawing a new
   box all change what is submitted.
3. After Submit and mark, each matched question has a submission with its crops and gets
   a mark; unmatched and removed regions are attached to nothing.
4. A question that already has submitted working is never changed; it is listed as
   skipped.
5. Cancel leaves no drafts, no submissions and no stored photos.
6. Mistakes are boxed on the crops in the mark screen as on any other image.
7. Another student's sheet cannot be used (404), and a region can only go to a question
   of the same sheet.
8. A demo copy without enough AI calls left is refused before the matching call.
9. Works at 375 px wide without sideways scrolling, including moving a region and
   adjusting a box by touch.
10. Attaching working one question at a time and "Submit all" behave exactly as before.

## Boundaries (only the deltas)

- **Always:** show the review screen before anything is submitted; check on the server
  that every crop's storage key is the student's own and every target question is on the
  sheet and can take working; keep submitted working unchangeable.
- **Ask first:** a migration, if the pending upload needs to be stored (see assumption
  2); changing the limit of 10 photos; cropping on the server (which needs an image
  library, a new dependency).
- **Never:** submit a region to a question without the student's confirmation; attach
  working to a question that already has a submitted attempt; use real student work in
  tests or fixtures.

## Assumptions (correct me if any is wrong)

1. Cropping happens in the browser, like the resizing today. The server never changes
   image pixels.
2. The uploaded photos and the proposed regions live only for the visit: closing the
   review screen without confirming is the same as Cancel, and the photos are deleted
   the next time the student opens the sheet. No new table.
3. A crop is saved as JPEG at the photo's resized resolution, with a small margin around
   the box so that nothing at the edge is cut off.
4. The difficulty rating is not asked for a batch upload (it stays on the question page).
5. The button is on the sheet page only, not in revision sessions.

## Out of scope (deferred)

- PDFs and multi-page scans in the batch upload.
- Matching typed text to questions.
- Uploading working for several sheets at once.
- Straightening or enhancing the photos.

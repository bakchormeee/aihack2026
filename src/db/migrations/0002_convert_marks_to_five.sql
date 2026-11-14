-- Marking v2 (SPEC-marking-v2.md): marks move from 0-100 to 0-5.
-- Only marks made before the change are converted: they have no mistakes list
-- (mistakes IS NULL); every mark made by the new marker has one, possibly empty.
-- Run this once, after the new code is live. Conversion table: 90+ -> 5, 70-89 -> 4,
-- 50-69 -> 3, 25-49 -> 2, 10-24 -> 1, below 10 -> 0. Outcome bands: 4-5 full, 2-3 partial, 0-1 stuck.
UPDATE "mark"
SET "score" = CASE
      WHEN "score" >= 90 THEN 5
      WHEN "score" >= 70 THEN 4
      WHEN "score" >= 50 THEN 3
      WHEN "score" >= 25 THEN 2
      WHEN "score" >= 10 THEN 1
      ELSE 0
    END
WHERE "mistakes" IS NULL;--> statement-breakpoint
UPDATE "mark"
SET "outcome" = CASE
      WHEN "score" >= 4 THEN 'full'::"outcome"
      WHEN "score" >= 2 THEN 'partial'::"outcome"
      ELSE 'stuck'::"outcome"
    END
WHERE "mistakes" IS NULL;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_score_0_to_5" CHECK ("score" >= 0 AND "score" <= 5);

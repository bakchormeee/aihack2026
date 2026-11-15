// Builds the demo template student (SPEC-demo.md, "The demo content"; task E5) in the
// database of DATABASE_URL, with the files in R2 and the real AI. A one-off, paid run
// (about 250 AI calls for all three courses): it asks for --yes.
//
// Run:
//   npx tsx --env-file=.env.local scripts/build-demo.ts --yes
//   npx tsx --env-file=.env.local scripts/build-demo.ts --yes --course "Numbers"
// Flags:
//   --course <name>   a course folder to build (repeatable; default all three)
//   --sheets <dir>    the folder of course folders (default ../Sample Problem Sheets)
//   --seed <n>        the history plan's seed (default 2026)
//   --questions-per-sheet <n>  answer only the first n questions of each sheet (default all)
//   --sheets-per-course <n>  1–3 sheets of each course (default 3; a quicker, smaller run)
//   --yes             really run

import path from "node:path";
import { parseArgs } from "node:util";

import { eraseDemoUser } from "../src/db/queries/demo";
import { DEMO_COURSES, buildDemoTemplate } from "../src/lib/demo/build-template";
import { getObjectBytes, putObject } from "../src/lib/storage/s3";

import { writeDemoWorking } from "./demo/write-demo-working";

const { values } = parseArgs({
  options: {
    course: { type: "string", multiple: true },
    sheets: { type: "string" },
    seed: { type: "string" },
    "sheets-per-course": { type: "string" },
    "questions-per-sheet": { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const courses = values.course ?? DEMO_COURSES;
const sheetsDir = path.resolve(
  values.sheets ?? path.join(process.cwd(), "..", "Sample Problem Sheets"),
);
const seed = values.seed ? Number(values.seed) : undefined;
const sheetsPerCourse = values["sheets-per-course"]
  ? Number(values["sheets-per-course"])
  : undefined;

async function main() {
  if (!values.yes) {
    console.log(
      [
        "This builds the demo template in the database of DATABASE_URL, uploads the sheets",
        "to the S3_BUCKET bucket and calls the AI for every step" +
          (process.env.AI_FIXTURES === "1" ? " (AI_FIXTURES=1: fixtures, no real calls)." : "."),
        `Courses: ${courses.join(", ")}. Sheets folder: ${sheetsDir}.`,
        "Run it again with --yes to go ahead.",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (seed !== undefined && !Number.isInteger(seed))
    throw new Error("--seed must be a whole number");

  const report = await buildDemoTemplate({
    sheetsDir,
    courses,
    seed,
    sheetsPerCourse,
    questionsPerSheet: values["questions-per-sheet"]
      ? Number(values["questions-per-sheet"])
      : undefined,
    storage: { put: putObject, get: getObjectBytes },
    writeWorking: writeDemoWorking,
    // Erase the previous template's rows. Its files stay in R2: live copies still read
    // them until they expire (SPEC-demo.md: rebuilding never touches live copies).
    eraseOld: (userId) => eraseDemoUser(userId, { deleteObject: async () => {} }),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

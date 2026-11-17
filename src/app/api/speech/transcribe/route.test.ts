import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { db } from "@/db";
import { users } from "@/db/schema";
import { DEMO_AI_LIMIT_MESSAGE } from "@/lib/ai/budget";
import { getCurrentUser } from "@/lib/auth/session";
import { transcribe } from "@/lib/speech/transcribe";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/speech/transcribe", async (original) => ({
  ...(await original<typeof import("@/lib/speech/transcribe")>()),
  transcribe: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.mocked(transcribe).mockReset().mockResolvedValue("The sign is wrong.");
});
afterEach(() => vi.unstubAllEnvs());

async function signIn(role: "copy" | null, used: number) {
  const [user] = await db.insert(users).values({ demoRole: role, demoAiCalls: used }).returning();
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  return user.id;
}
async function calls(id: string) {
  return (await db.select().from(users).where(eq(users.id, id)))[0].demoAiCalls;
}
function recording(valid = true) {
  const body = new FormData();
  if (valid) body.append("audio", new Blob(["audio"], { type: "audio/webm" }), "answer.webm");
  return new Request("http://localhost/api/speech/transcribe", { method: "POST", body });
}

it("counts a transcription against the demo budget", async () => {
  const id = await signIn("copy", 0);
  const response = await POST(recording());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ text: "The sign is wrong." });
  expect(await calls(id)).toBe(1);
});

it("refuses exhausted copies before contacting the paid service", async () => {
  const id = await signIn("copy", 30);
  const response = await POST(recording());
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: DEMO_AI_LIMIT_MESSAGE });
  expect(transcribe).not.toHaveBeenCalled();
  expect(await calls(id)).toBe(30);
});

it("allows only one concurrent transcription with one call left", async () => {
  const id = await signIn("copy", 29);
  const responses = await Promise.all([POST(recording()), POST(recording())]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
  expect(transcribe).toHaveBeenCalledTimes(1);
  expect(await calls(id)).toBe(30);
});

it("does not charge real accounts", async () => {
  const id = await signIn(null, 0);
  expect((await POST(recording())).status).toBe(200);
  expect(await calls(id)).toBe(0);
});

it("does not charge invalid uploads or disabled speech", async () => {
  const id = await signIn("copy", 0);
  expect((await POST(recording(false))).status).toBe(400);
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  expect((await POST(recording())).status).toBe(502);
  expect(transcribe).not.toHaveBeenCalled();
  expect(await calls(id)).toBe(0);
});

it("requires sign-in", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  expect((await POST(recording())).status).toBe(401);
  expect(transcribe).not.toHaveBeenCalled();
});

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn(async (command: unknown) => {
  void command;
  return {};
});

// The real commands are kept; only the client is replaced, so no request leaves the test.
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send = send;
  },
}));

const { putObject } = await import("./s3");

beforeEach(() => {
  send.mockClear();
  vi.stubEnv("S3_ENDPOINT", "https://s3.example.invalid");
  vi.stubEnv("S3_ACCESS_KEY_ID", "test-id");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("S3_BUCKET", "test-bucket");
});

describe("putObject", () => {
  it("uploads the bytes under the key with the content type, to the configured bucket", async () => {
    const body = Buffer.from("%PDF-1.4 test");

    await putObject("u/user-1/sheet/course-1/a.pdf", body, "application/pdf");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: "test-bucket",
      Key: "u/user-1/sheet/course-1/a.pdf",
      Body: body,
      ContentType: "application/pdf",
      ContentLength: body.length,
    });
  });

  it("fails without a bucket and sends nothing", async () => {
    vi.stubEnv("S3_BUCKET", "");
    await expect(putObject("k", Buffer.from("x"), "application/pdf")).rejects.toThrow(/S3_BUCKET/);
    expect(send).not.toHaveBeenCalled();
  });
});

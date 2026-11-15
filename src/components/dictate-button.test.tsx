import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the component's event handlers and effect cleanup without a DOM.
const lifecycle = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: (setup: () => () => void) => {
    lifecycle.cleanup = setup();
  },
}));
vi.mock("@/lib/sfx", () => ({ playSfx: vi.fn() }));

import { DictateButton } from "./dictate-button";

class Recorder {
  static instances: Recorder[] = [];
  state = "inactive";
  mimeType = "audio/webm";
  onstop: null | (() => void) = null;
  ondataavailable: null | ((event: { data: Blob }) => void) = null;
  constructor(public stream: MediaStream) {
    Recorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    // Browser recording events arrive asynchronously, after effect cleanup.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["speech"]) });
      this.onstop?.();
    });
  }
}

const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
const fetchMock = vi.fn();
beforeEach(() => {
  Recorder.instances = [];
  stopTrack.mockReset();
  getUserMedia.mockReset().mockResolvedValue(stream);
  fetchMock.mockReset().mockResolvedValue(Response.json({ text: "spoken answer" }));
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  lifecycle.cleanup?.();
  vi.unstubAllGlobals();
});

function mount() {
  const onText = vi.fn();
  const element = DictateButton({ onText }) as ReactElement<{ children: ReactElement[] }>;
  const button = element.props.children[0] as ReactElement<{ onClick: () => Promise<void> }>;
  return { start: button.props.onClick, onText };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("releases an active microphone without uploading when unmounted", async () => {
  const { start, onText } = mount();
  await start();
  lifecycle.cleanup?.();
  await flush();
  expect(stopTrack).toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onText).not.toHaveBeenCalled();
});

it("releases permission granted after unmount without starting a recorder", async () => {
  let grant!: (stream: MediaStream) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
  );
  const { start } = mount();
  const pending = start();
  lifecycle.cleanup?.();
  grant(stream);
  await pending;
  expect(stopTrack).toHaveBeenCalled();
  expect(Recorder.instances).toHaveLength(0);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("still uploads a normally stopped recording and delivers its text", async () => {
  const { start, onText } = mount();
  await start();
  Recorder.instances[0].stop();
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onText).toHaveBeenCalledWith("spoken answer");
  expect(stopTrack).toHaveBeenCalled();
});

it("aborts an in-flight upload and ignores its result after unmount", async () => {
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { start, onText } = mount();
  await start();
  Recorder.instances[0].stop();
  await flush();
  lifecycle.cleanup?.();
  expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  finish(Response.json({ text: "too late" }));
  await flush();
  expect(onText).not.toHaveBeenCalled();
});

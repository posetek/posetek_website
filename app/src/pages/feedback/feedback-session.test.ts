import { describe, expect, it, vi } from "vitest";
import {
  createFeedbackSession, emptyFeedbackAnswers, FEEDBACK_COMMENT_LIMIT, FEEDBACK_ENDPOINT,
  hasFeedbackAnswers, nextFeedbackStep, prepareFeedbackAnswers, readFeedbackEntry,
} from "./feedback-session";
import type { FeedbackPayload } from "./feedback-session";

const makeId = () => "94087be4-3990-4311-bfcf-8886610d4c8a";
const success = () => Promise.resolve(new Response(null, { status: 200 }));

describe("public feedback flow", () => {
  it("only reads the source allowlist and explicit preview flag from the URL", () => {
    for (const source of ["workout", "results", "qr", "message"] as const) {
      expect(readFeedbackEntry(`?source=${source}&playerId=private&token=secret`)).toEqual({ source, preview: false });
    }
    expect(readFeedbackEntry("?source=private-team&preview=true&email=child@example.com")).toEqual({ source: "direct", preview: false });
    expect(readFeedbackEntry("?source=qr&preview=1")).toEqual({ source: "qr", preview: true });
    expect(readFeedbackEntry("")).toEqual({ source: "direct", preview: false });
  });

  it("permits every question to be skipped and goes to the optional comment", () => {
    const answers = emptyFeedbackAnswers();
    expect(nextFeedbackStep(0, answers)).toBe(1);
    expect(nextFeedbackStep(1, answers)).toBe(2);
    expect(nextFeedbackStep(2, answers)).toBe(3);
    expect(nextFeedbackStep(3, answers)).toBe("submit");
    expect(hasFeedbackAnswers(answers)).toBe(false);
    expect(hasFeedbackAnswers({ ...answers, comment: "   \n " })).toBe(false);
    expect(hasFeedbackAnswers({ ...answers, comment: "I could not find videos" })).toBe(true);
  });

  it("ends the not-used path before ratings and clears stale answers", () => {
    const answers = { ...emptyFeedbackAnswers(), feature: "notUsed" as const, ease: "easy" as const, obstruction: "broken" as const, comment: "old comment" };
    expect(nextFeedbackStep(0, answers)).toBe("submit");
    expect(prepareFeedbackAnswers(answers)).toEqual({ feature: "notUsed", ease: null, obstruction: null, comment: "" });
    expect(hasFeedbackAnswers(answers)).toBe(true);
  });

  it("keeps writing optional and bounded without retaining other input fields", () => {
    const answers = { ...emptyFeedbackAnswers(), comment: `  ${"a".repeat(1100)}  `, uid: "private" };
    const prepared = prepareFeedbackAnswers(answers);
    expect(prepared.comment).toHaveLength(FEEDBACK_COMMENT_LIMIT);
    expect(Object.keys(prepared)).toEqual(["feature", "ease", "obstruction", "comment"]);
  });
});

describe("isolated public feedback transport", () => {
  it("omits credentials, referrer and account context from every request", async () => {
    const fetcher = vi.fn<typeof fetch>(success);
    let time = 1000;
    const session = createFeedbackSession({ source: "workout", fetcher, now: () => time, makeId });
    session.open();
    session.open();
    session.start();
    session.start();
    time = 46000;
    await expect(session.submit({ ...emptyFeedbackAnswers(), ease: "hard" })).resolves.toBe("submitted");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const payloads = fetcher.mock.calls.map(([url, init]) => {
      expect(url).toBe(FEEDBACK_ENDPOINT);
      expect(init?.credentials).toBe("omit");
      expect(init?.referrerPolicy).toBe("no-referrer");
      expect(init?.mode).toBe("cors");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(init?.body as string) as FeedbackPayload;
      expect(body.sessionId).toBe(makeId());
      expect(body.entrySource).toBe("workout");
      expect(body.formVersion).toBe(1);
      return body;
    });
    expect(payloads.map(payload => payload.event)).toEqual(["opened", "started", "submitted"]);
    expect(Object.keys(payloads[0])).toEqual(["formVersion", "event", "sessionId", "entrySource"]);
    expect(payloads[2]).toEqual({ formVersion: 1, event: "submitted", sessionId: makeId(), entrySource: "workout",
      answers: { feature: null, ease: "hard", obstruction: null, comment: "" }, durationSeconds: 45 });
  });

  it("retries the exact accepted snapshot and identity after a lost response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("Offline")).mockImplementation(success);
    let time = 1000;
    const session = createFeedbackSession({ source: "results", fetcher, makeId, now: () => time });
    const answers = { ...emptyFeedbackAnswers(), feature: "results" as const, comment: "The results were easy to find" };
    time = 31000;
    await expect(session.submit(answers)).rejects.toThrow("Offline");
    time = 50000;
    await expect(session.submit({ ...answers, comment: "changed" })).resolves.toBe("submitted");
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string).answers.comment).toBe(answers.comment);
  });

  it("does not submit an empty response", async () => {
    const fetcher = vi.fn<typeof fetch>(success);
    const session = createFeedbackSession({ source: "direct", fetcher, makeId });
    await expect(session.submit(emptyFeedbackAnswers())).resolves.toBe("empty");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preview mode performs no production requests, including submissions", async () => {
    const fetcher = vi.fn<typeof fetch>(success);
    const session = createFeedbackSession({ source: "qr", preview: true, fetcher, makeId });
    session.open();
    session.start();
    await expect(session.submit({ ...emptyFeedbackAnswers(), feature: "notUsed" })).resolves.toBe("submitted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("diagnostic failures cannot prevent sending feedback", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("Network down"))
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(success);
    const session = createFeedbackSession({ source: "message", fetcher, makeId });
    session.open();
    session.start();
    await expect(session.submit({ ...emptyFeedbackAnswers(), obstruction: "find" })).resolves.toBe("submitted");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("treats unsuccessful server responses as retryable failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 429 })).mockImplementation(success);
    const session = createFeedbackSession({ source: "direct", fetcher, makeId });
    const answers = { ...emptyFeedbackAnswers(), feature: "workouts" as const };
    await expect(session.submit(answers)).rejects.toThrow("Feedback could not be saved");
    await expect(session.submit(answers)).resolves.toBe("submitted");
  });

  it("bounds duration and creates a new ephemeral identity for each opening", async () => {
    const fetcher = vi.fn<typeof fetch>(success);
    let time = 0;
    const session = createFeedbackSession({ source: "direct", fetcher, now: () => time });
    const second = createFeedbackSession({ source: "direct", fetcher, now: () => time });
    time = 90000000;
    await session.submit({ ...emptyFeedbackAnswers(), feature: "other" });
    await second.submit({ ...emptyFeedbackAnswers(), feature: "other" });
    const payloads = fetcher.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as FeedbackPayload);
    expect(payloads[0].durationSeconds).toBe(86400);
    expect(payloads[0].sessionId).not.toBe(payloads[1].sessionId);
    expect(payloads[0].sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

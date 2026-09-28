import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkoutActivity, workoutActivityLog, workoutActivitySessionId, WORKOUT_ACTIVITY_HEARTBEAT_MS, WORKOUT_ACTIVITY_MAX_AGE_MS } from './workout-activity';
import type { WorkoutActivityRequest, WorkoutActivityResponse, WorkoutActivityState } from './workout-activity';

const initialTime = Date.parse('2026-09-28T18:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(initialTime); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  const current: WorkoutActivityState = { uid: 'auth-player', playerId: 'player-document',
    currentOwner: true, visible: true, running: true, ended: false, blockId: 'first' };
  let online = true;
  const send = vi.fn<(request: WorkoutActivityRequest) => Promise<WorkoutActivityResponse>>()
    .mockResolvedValue({ accepted: true, ownerEpoch: 7, serverTimeMillis: initialTime });
  const tracker = createWorkoutActivity({ uid: 'auth-player', playerId: 'player-document',
    source: 'workoutLogs', logId: 'plan_workout', sessionId: 'tab-session',
    read: () => current, send, online: () => online, newSessionId: () => 'new-session' });
  return { tracker, current, send, offline: () => { online = false; }, online: () => { online = true; } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
async function claim(value: ReturnType<typeof setup>) { value.tracker.resume(); await settle(); }

describe('web workout activity identity and ownership', () => {
  it('uses the server UUID format even when browser randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(workoutActivitySessionId()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });
  it('keeps assigned and personal log namespaces separate and strips only the UI prefix', () => {
    expect(workoutActivityLog('plan', 'p_w')).toEqual({ source: 'workoutLogs', logId: 'p_w' });
    expect(workoutActivityLog('personal', 'personal_actual')).toEqual({ source: 'personalWorkoutLogs', logId: 'actual' });
    expect(workoutActivityLog('personal', 'personal_personal_actual')).toEqual({ source: 'personalWorkoutLogs', logId: 'personal_actual' });
  });
  it('claims the current session once and attaches its returned epoch to later events', async () => {
    const value = setup(); await claim(value);
    expect(value.send).toHaveBeenCalledWith({ source: 'workoutLogs', logId: 'plan_workout', sessionId: 'tab-session',
      sequence: 0, eventId: 'tab-session:0', type: 'resume', occurredAtMillis: initialTime, blockId: 'first' });
    value.tracker.heartbeat(); await settle();
    expect(value.send.mock.calls[1][0]).toMatchObject({ type: 'heartbeat', ownerEpoch: 7, sequence: 1 });
    expect(value.send.mock.calls[1][0]).not.toHaveProperty('playerId');
    value.tracker.dispose();
  });
  it('does not claim from a heartbeat, a paused restoration, or a pause', async () => {
    const value = setup(); value.tracker.heartbeat(); value.tracker.pause();
    value.current.running = false; value.tracker.resume(); await settle();
    expect(value.send).not.toHaveBeenCalled();
    value.current.running = true; await claim(value); expect(value.send).toHaveBeenCalledOnce();
    value.tracker.dispose();
  });
  it.each(['account', 'player', 'owner', 'ended', 'hidden', 'paused'])('blocks activity after %s changes', async change => {
    const value = setup(); await claim(value);
    if (change === 'account') value.current.uid = 'other-auth';
    if (change === 'player') value.current.playerId = 'other-player';
    if (change === 'owner') value.current.currentOwner = false;
    if (change === 'ended') value.current.ended = true;
    if (change === 'hidden') value.current.visible = false;
    if (change === 'paused') value.current.running = false;
    value.tracker.progress(); value.tracker.heartbeat(); await vi.advanceTimersByTimeAsync(60_000);
    expect(value.send).toHaveBeenCalledOnce(); value.tracker.dispose();
  });
  it('never sends preview activity', async () => {
    const send = vi.fn();
    const tracker = createWorkoutActivity({ uid: 'preview', playerId: 'sample', source: 'workoutLogs', logId: 'sample', sessionId: 'sample', send,
      read: () => ({ uid: 'preview', playerId: 'sample', currentOwner: true, visible: true, running: true, ended: false }) });
    tracker.resume(); tracker.progress(); tracker.pause(); await tracker.flush();
    expect(send).not.toHaveBeenCalled(); tracker.dispose();
  });
  it('retires a stale owner instead of reclaiming in response to timer ticks or later callbacks', async () => {
    const value = setup(); await claim(value);
    value.send.mockResolvedValue({ accepted: false, reason: 'not-current-owner' });
    value.tracker.heartbeat(); await settle();
    value.tracker.resume(); value.tracker.progress(); value.tracker.heartbeat();
    await vi.advanceTimersByTimeAsync(60_000); expect(value.send).toHaveBeenCalledTimes(2);
    value.tracker.dispose();
  });
  it('discards queued events and an in-flight response after account changes', async () => {
    const value = setup(); let resolve!: (response: WorkoutActivityResponse) => void;
    value.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    value.tracker.resume(); value.tracker.progress(); value.current.uid = 'other-auth';
    resolve({ accepted: true, ownerEpoch: 7 }); await vi.advanceTimersByTimeAsync(60_000);
    expect(value.send).toHaveBeenCalledOnce(); value.tracker.dispose();
  });
});

describe('bounded activity queue and inactivity meaning', () => {
  it('coalesces rapid interaction positions but preserves activity before a passive pause', async () => {
    const value = setup(); await claim(value);
    vi.setSystemTime(initialTime + 5_000); value.tracker.progress();
    vi.setSystemTime(initialTime + 5_200); value.current.blockId = 'second'; value.tracker.progress();
    vi.setSystemTime(initialTime + 5_500); value.current.running = false; value.tracker.pause();
    await vi.advanceTimersByTimeAsync(1);
    const events = value.send.mock.calls.map(([request]) => request);
    expect(events.map(event => event.type)).toEqual(['resume', 'progress', 'pause']);
    expect(events[1]).toMatchObject({ sequence: 2, occurredAtMillis: initialTime + 5_200, blockId: 'second' });
    expect(events[2]).toMatchObject({ sequence: 3, occurredAtMillis: initialTime + 5_500, blockId: 'second' });
    value.tracker.dispose();
  });
  it('reports foreground liveness without converting it to new progress', async () => {
    const value = setup(); await claim(value);
    for (let count = 1; count <= 31; count++) {
      vi.setSystemTime(initialTime + count * WORKOUT_ACTIVITY_HEARTBEAT_MS);
      value.tracker.heartbeat(); await settle();
    }
    expect(value.send.mock.calls.slice(1).every(([request]) => request.type === 'heartbeat')).toBe(true);
    value.current.running = false; value.tracker.pause(); await settle();
    value.tracker.heartbeat(); expect(value.send).toHaveBeenCalledTimes(33);
    value.tracker.dispose();
  });
  it('retries a failed ownership response with exactly the same event ID and action time', async () => {
    const value = setup(); value.send.mockRejectedValueOnce(new Error('connection lost'));
    value.tracker.resume(); await settle(); await vi.advanceTimersByTimeAsync(10_000);
    expect(value.send).toHaveBeenCalledTimes(2);
    expect(value.send.mock.calls[1][0]).toEqual(value.send.mock.calls[0][0]);
    value.tracker.heartbeat(); await settle(); expect(value.send.mock.calls[2][0].ownerEpoch).toBe(7);
    value.tracker.dispose();
  });
  it('does not replay offline activity as fresh on reconnect and needs a new explicit action to claim', async () => {
    const value = setup(); value.offline(); value.tracker.resume(); value.tracker.progress();
    await vi.advanceTimersByTimeAsync(WORKOUT_ACTIVITY_MAX_AGE_MS + 1);
    value.online(); await value.tracker.flush(); value.tracker.heartbeat();
    expect(value.send).not.toHaveBeenCalled();
    value.tracker.progress(); await settle();
    expect(value.send).toHaveBeenCalledOnce();
    expect(value.send.mock.calls[0][0]).toMatchObject({ sessionId: 'new-session', sequence: 0, type: 'resume', occurredAtMillis: Date.now() });
    value.tracker.dispose();
  });
  it('drops expired progress after an established claim rather than renewing it on reconnect', async () => {
    const value = setup(); await claim(value); value.offline(); value.tracker.progress();
    await vi.advanceTimersByTimeAsync(WORKOUT_ACTIVITY_MAX_AGE_MS + 1);
    value.online(); await value.tracker.flush(); value.tracker.heartbeat(); await settle();
    expect(value.send.mock.calls.map(([request]) => request.type)).toEqual(['resume', 'heartbeat']);
    value.tracker.dispose();
  });
  it('keeps the original interaction time when a workout save acknowledges late', async () => {
    const value = setup(); await claim(value);
    vi.setSystemTime(initialTime + 10_000); const actionAt = Date.now();
    vi.setSystemTime(actionAt + WORKOUT_ACTIVITY_MAX_AGE_MS + 1);
    value.tracker.progress(actionAt); await vi.advanceTimersByTimeAsync(1_000);
    expect(value.send).toHaveBeenCalledOnce(); value.tracker.dispose();
  });
  it('flushes a route-leave position after its in-flight claim without creating a new activity time', async () => {
    const value = setup(); let resolve!: (response: WorkoutActivityResponse) => void;
    value.send.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    value.tracker.resume(); vi.setSystemTime(initialTime + 2_000);
    value.current.running = false; value.current.visible = false; value.current.blockId = 'second'; value.tracker.close();
    resolve({ accepted: true, ownerEpoch: 7 }); await vi.advanceTimersByTimeAsync(1);
    expect(value.send.mock.calls.map(([request]) => request.type)).toEqual(['resume', 'pause']);
    expect(value.send.mock.calls[1][0]).toMatchObject({ blockId: 'second', occurredAtMillis: initialTime + 2_000, ownerEpoch: 7 });
    value.current.running = true; value.current.visible = true; value.tracker.resume(); expect(value.send).toHaveBeenCalledTimes(2);
  });
  it('never rejects or blocks the caller when reporting fails', async () => {
    const value = setup(); value.send.mockRejectedValue(new Error('unavailable'));
    expect(() => value.tracker.resume()).not.toThrow(); await expect(value.tracker.flush()).resolves.toBeUndefined();
    value.tracker.dispose(); await vi.advanceTimersByTimeAsync(120_000);
    expect(value.send).toHaveBeenCalledOnce();
  });
  it('does not retry permanent account or payload refusals', async () => {
    const value = setup(); value.send.mockRejectedValue({ code: 'functions/permission-denied' });
    value.tracker.resume(); await vi.advanceTimersByTimeAsync(120_000);
    expect(value.send).toHaveBeenCalledOnce(); value.tracker.dispose();
  });
});

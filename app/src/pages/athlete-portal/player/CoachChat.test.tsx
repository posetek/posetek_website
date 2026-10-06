import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  states: [] as any[], refs: [] as { current: any }[], stateIndex: 0, refIndex: 0,
  get: vi.fn(), stream: vi.fn(),
}));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial;
    return [harness.states[index], (value: any) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value; }];
  },
  useRef: (initial: any) => {
    const index = harness.refIndex++;
    return harness.refs[index] ||= { current: initial };
  },
  useEffect: () => {},
}));
vi.mock('../../../lib/firebase', () => {
  const chain: any = { get: harness.get };
  for (const method of ['collection', 'doc', 'orderBy']) chain[method] = () => chain;
  return { auth: { currentUser: { uid: 'owned-player' } }, db: chain };
});
vi.mock('../lib/mobile', () => ({ dateText: () => '' }));
vi.mock('../views/shared', () => ({ MultilineText: () => null }));
vi.mock('./CoachPersonalWorkout', () => ({ default: () => null }));
vi.mock('./coach-prompts', () => ({ coachPrompts: () => [], coachToolStatus: () => '' }));
vi.mock('./gateway', () => ({
  useCoachConfig: () => ({ coachWorkspaceEnabled: false }), capabilityEnabled: () => true,
  validHandoff: () => false, streamCoach: harness.stream,
}));
import CoachChat from './CoachChat';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}
const snapshot = (content: string) => ({ docs: [{ id: 'saved-message', data: () => ({ role: 'assistant', content }) }] });
function render() {
  harness.stateIndex = 0; harness.refIndex = 0;
  return CoachChat({ playerId: 'synthetic-player', preview: false, initialText: 'Yes, build it.' });
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
}
function find(node: any, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> {
  if (Array.isArray(node)) {
    for (const child of node) { const found = search(child, predicate); if (found) return found; }
  } else { const found = search(node, predicate); if (found) return found; }
  throw new Error('Expected rendered control missing');
}
function search(node: any, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> | undefined {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) { const found = search(child, predicate); if (found) return found; } return; }
  if (predicate(node)) return node;
  return search(node.props?.children, predicate);
}
const button = (tree: ReactElement<any>, label: string) => find(tree, element => element.type === 'button' && text(element) === label);
const submit = (tree: ReactElement<any>) => find(tree, element => element.type === 'form').props.onSubmit({ preventDefault() {} });
function history() {
  render(); harness.states[5] = [{ id: 'selected-chat', title: 'Selected chat' }, { id: 'other-chat', title: 'Other chat' }];
  button(render(), 'History').props.onClick(); return render();
}

describe('Coach History server-read handoff', () => {
  beforeEach(() => {
    harness.states.length = 0; harness.refs.length = 0; harness.get.mockReset(); harness.stream.mockReset();
    harness.get.mockResolvedValue({ docs: [] }); harness.stream.mockResolvedValue(undefined);
  });

  it('blocks the same-event send until history loads, then sends to the selected conversation', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>(); harness.get.mockReturnValueOnce(pending.promise);
    const oldTree = history(); button(oldTree, 'Selected chat').props.onClick();
    // A submit before React can render the disabled composer exposed the live race.
    submit(oldTree); expect(harness.stream).not.toHaveBeenCalled();
    const busy = render();
    expect(busy.props['aria-busy']).toBe(true);
    expect(find(busy, element => element.type === 'textarea').props.disabled).toBe(true);
    expect(find(busy, element => element.props['aria-label'] === 'Send message').props.disabled).toBe(true);
    expect(text(busy)).toContain('Loading your conversation…');
    expect(text(busy)).not.toContain('What do you want to work on?');
    pending.resolve(snapshot('Your saved workout request.'));
    await vi.waitFor(() => expect(render().props['aria-busy']).toBe(false));
    submit(render());
    await vi.waitFor(() => expect(harness.stream).toHaveBeenCalledTimes(1));
    expect(harness.stream.mock.calls[0][0]).toMatchObject({ playerId: 'synthetic-player', conversationId: 'selected-chat', message: 'Yes, build it.' });
  });

  it('lets New conversation cancel a pending load without an old reply rebinding the next send', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>(); harness.get.mockReturnValueOnce(pending.promise);
    const tree = history(); button(tree, 'Selected chat').props.onClick();
    button(render(), 'New conversation').props.onClick();
    expect(render().props['aria-busy']).toBe(false);
    pending.resolve(snapshot('Old chat content.')); await Promise.resolve(); await Promise.resolve();
    submit(render());
    await vi.waitFor(() => expect(harness.stream).toHaveBeenCalledTimes(1));
    expect(harness.stream.mock.calls[0][0]).not.toHaveProperty('conversationId');
    expect(text(render())).not.toContain('Old chat content.');
  });

  it('keeps a newer load blocked when an older server read finishes', async () => {
    const first = deferred<ReturnType<typeof snapshot>>(), second = deferred<ReturnType<typeof snapshot>>();
    harness.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const tree = history(); button(tree, 'Selected chat').props.onClick(); button(tree, 'Other chat').props.onClick();
    first.resolve(snapshot('Older conversation.')); await Promise.resolve(); await Promise.resolve();
    expect(render().props['aria-busy']).toBe(true); submit(render()); expect(harness.stream).not.toHaveBeenCalled();
    second.resolve(snapshot('Newer conversation.'));
    await vi.waitFor(() => expect(render().props['aria-busy']).toBe(false)); submit(render());
    await vi.waitFor(() => expect(harness.stream).toHaveBeenCalledTimes(1));
    expect(harness.stream.mock.calls[0][0].conversationId).toBe('other-chat');
  });

  it('releases the composer and shows a failed history read without binding that conversation', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>(); harness.get.mockReturnValueOnce(pending.promise);
    button(history(), 'Selected chat').props.onClick(); pending.reject(new Error('History unavailable'));
    await vi.waitFor(() => expect(render().props['aria-busy']).toBe(false));
    expect(text(render())).toContain('History unavailable');
    expect(find(render(), element => element.type === 'textarea').props.disabled).toBe(false);
    submit(render()); await vi.waitFor(() => expect(harness.stream).toHaveBeenCalledTimes(1));
    expect(harness.stream.mock.calls[0][0]).not.toHaveProperty('conversationId');
  });
});

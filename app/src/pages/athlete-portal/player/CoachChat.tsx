import { useEffect, useRef, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import { dateText } from '../lib/mobile';
import { MultilineText } from '../views/shared';
import { capabilityEnabled, streamCoach, useCoachConfig, validHandoff } from './gateway';
import type { Row } from './execution';
import { coachPrompts, coachToolStatus } from './coach-prompts';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import CoachPersonalWorkout from './CoachPersonalWorkout';

type Props = { playerId: string; preview: boolean; capability?: string; context?: Row; initialText?: string;
  onDraft?: (draft: Row | null) => void; onHandoff?: (request: Row) => void; personalStore?: PersonalWorkoutStore; athlete?: Row; active?: boolean };

export default function CoachChat({ playerId, preview, capability = 'pose_chat', context, initialText = '', onDraft, onHandoff, personalStore, athlete, active = true }: Props) {
  const config = useCoachConfig(preview);
  const [draft, setDraft] = useState(initialText), [messages, setMessages] = useState<Row[]>([]);
  const [answer, setAnswer] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [history, setHistory] = useState<Row[]>([]), [showHistory, setShowHistory] = useState(false);
  const [memory, setMemory] = useState<Row | null>(null), [showMemory, setShowMemory] = useState(false);
  const [status, setStatus] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const controller = useRef<AbortController | null>(null), conversation = useRef<string | null>(null);
  const historyLoadingRef = useRef(false);
  const turn = useRef(0), messageRoot = useRef<HTMLDivElement>(null);
  const workspace = capability === 'pose_chat' && config?.coachWorkspaceEnabled === true;
  const canChat = capabilityEnabled(config, capability);
  const readMessages = async (id: string): Promise<Row[]> => {
    const snap = await db.collection('players').doc(playerId).collection('aiConversations').doc(id).collection('messages').orderBy('createdAt').get({ source: 'server' });
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  };
  useEffect(() => {
    if (preview) return;
    const base = db.collection('players').doc(playerId).collection('aiConversations')
      .where('capability', '==', capability).where('createdByUid', '==', auth.currentUser?.uid || '');
    return base.onSnapshot(s => setHistory(s.docs.map(d => ({ ...d.data(), id: d.id })).sort((a: Row, b: Row) =>
      (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0))), e => setError(`History: ${e.message}`));
  }, [playerId, preview, capability]);
  useEffect(() => () => { turn.current++; controller.current?.abort(); }, []);
  useEffect(() => { messageRoot.current?.scrollTo({ top: messageRoot.current.scrollHeight }); }, [messages, answer]);

  const reset = () => {
    turn.current++; controller.current?.abort(); controller.current = null;
    historyLoadingRef.current = false; setHistoryLoading(false);
    conversation.current = null; setMessages([]); setAnswer(''); setSending(false); setError(''); onDraft?.(null);
  };
  const openHistory = async (item: Row) => {
    reset(); const token = turn.current;
    historyLoadingRef.current = true; setHistoryLoading(true);
    try {
      const bound = item.workoutTarget;
      const matches = (target: Row | undefined) => target && target.kind === context?.workoutRef?.kind &&
        (context?.workoutRef?.planId ? target.planId === context.workoutRef.planId : true) &&
        (target.kind === 'plan' ? target.workoutId === context?.workoutRef.workoutId : target.kind === 'adhoc' ? target.plannedWorkoutId === context?.workoutRef.plannedWorkoutId : true);
      if (capability === 'workout_chat' && !matches(bound)) {
        throw new Error('Open this workout from Training to continue its chat.');
      }
      const rows = await readMessages(item.id);
      if (token !== turn.current) return;
      conversation.current = item.id; setMessages(rows); setShowHistory(false);
      // Recover a durable proposal only through its completed assistant turn.
      if (capability === 'workout_chat') {
        const last = rows.at(-1);
        if (last?.role === 'assistant' && last.draftId) {
          const doc = await db.collection('players').doc(playerId).collection('workoutDrafts').doc(last.draftId).get({ source: 'server' });
          const d = doc.data();
          const lastUser = [...rows].reverse().find(r => r.role === 'user');
          if (token === turn.current && d?.status === 'proposed' && d.check?.ok === true && d.createdByUid === auth.currentUser?.uid &&
              d.playerId === playerId && d.conversationId === item.id && matches(d.target) &&
              (bound.kind !== 'new' || bound.weekNumber === d.target.weekNumber) && last.createdAt &&
              d.sourceMessageId === lastUser?.id && d.expiresAt?.toMillis?.() > Date.now()) onDraft?.({ ...d, draftId: doc.id });
        }
      }
    } catch (e: any) { if (token === turn.current) setError(e.message); }
    finally { if (token === turn.current) { historyLoadingRef.current = false; setHistoryLoading(false); } }
  };

  const send = async (text: string, memoryAction?: Row) => {
    if (!canChat || controller.current || historyLoadingRef.current || (!memoryAction && !text.trim())) return;
    const token = ++turn.current;
    controller.current = new AbortController(); setSending(true); setError(''); setAnswer(''); onDraft?.(null);
    if (!memoryAction) { setDraft(''); setMessages(rows => [...rows, { role: 'user', content: text }]); }
    let full = '', proposal: Row | null = null, memorySnapshot: Row | null = null, handoff: Row | null = null;
    try {
      if (preview) {
        if (memoryAction) setMemory({ workspace: { schemaVersion: 1, revision: (memory?.workspace.revision || 0) + 1, enabled: memoryAction.enabled ?? true }, memories: [] });
        else {
          setMessages(rows => [...rows, { role: 'assistant', content: 'This is a local preview. Your signed-in coach uses your results, training plan and the preferences you choose to save.' }]);
          if (capability === 'pose_chat') setMessages(rows => [...rows.slice(0, -1), { id: `sample-${Date.now()}`, role: 'assistant', content: 'Let’s prepare a session around your request. You can review and change it in Training before publishing.', workoutRequest: { type: 'workout_request', playerId, request: text, destination: personalStore?.enabled ? 'personal_workout' : 'workout_builder' } }]);
        }
        return;
      }
      await streamCoach({ capability, playerId, message: text,
        ...(conversation.current ? { conversationId: conversation.current } : {}),
        context: { ...context, ...(workspace ? { coachWorkspaceVersion: 1 } : {}), ...(workspace && personalStore?.enabled ? { personalWorkoutFlowVersion: 1 } : {}), ...(memoryAction ? { memoryAction } : {}) },
      }, controller.current.signal, frame => {
        if (token !== turn.current) return;
        if (frame.event === 'start' && !memoryAction) conversation.current = frame.data.conversationId;
        if (frame.event === 'delta') { full += frame.data.text || ''; setAnswer(full); }
        if (frame.event === 'tool') setStatus(coachToolStatus(frame.data.name, frame.data.status === 'finished'));
        if (frame.event === 'draft') proposal = frame.data;
        if (frame.event === 'memory') memorySnapshot = frame.data;
        if (frame.event === 'workout_request' || frame.data.type === 'workout_request') handoff = frame.data;
      });
      if (token !== turn.current) return;
      if (memorySnapshot) setMemory(old => (memorySnapshot!.workspace?.revision >= (old?.workspace?.revision || 0) ? memorySnapshot : old));
      if (!memoryAction) {
        const rows = conversation.current ? await readMessages(conversation.current) : [];
        if (token !== turn.current) return;
        setMessages(rows.length ? rows : [...messages, { role: 'user', content: text }, { role: 'assistant', content: full, workoutRequest: handoff }]);
        onDraft?.(proposal && (proposal as Row).check?.ok === true ? proposal : null);
      }
      setAnswer('');
    } catch (e: any) {
      if (token === turn.current) {
        setError(e.name === 'AbortError' ? 'Reply stopped. Check the saved conversation before sending again.' : e.message);
        if (!memoryAction) setDraft(text);
      }
      if (token === turn.current) onDraft?.(null);
    } finally {
      if (token === turn.current) { controller.current = null; setSending(false); setStatus(''); }
    }
  };
  const memoryCommand = (kind: string, extra: Row = {}) => void send('', { kind, ...(kind !== 'list' ? { expectedRevision: memory?.workspace.revision } : {}), ...extra });
  return <section className="player-chat" aria-busy={sending || historyLoading}>
    <div className="player-actions">
      <button type="button" disabled={historyLoading} onClick={() => setShowHistory(v => !v)}>History</button>
      <button type="button" onClick={reset}>New conversation</button>
      {workspace && <button type="button" disabled={historyLoading} onClick={() => { setShowMemory(v => !v); memoryCommand('list'); }}>Coach memory</button>}
    </div>
    {showHistory && <section className="portal-card"><h2>Conversations</h2>{history.length ? history.map(item => <button className="player-list-button" key={item.id} disabled={historyLoading} onClick={() => void openHistory(item)}>{item.title || 'Conversation'}<small>{dateText(item.lastMessageAt)}</small></button>) : <p>No conversations yet.</p>}</section>}
    {showMemory && <section className="portal-card"><h2>Coach memory</h2><p>Choose what your coach remembers across conversations.</p>
      {!memory ? <p>Loading memory…</p> : <>
        <label><input type="checkbox" checked={memory.workspace.enabled} disabled={sending} onChange={e => memoryCommand('setEnabled', { enabled: e.target.checked })} /> Use coach memory</label>
        {(memory.memories || []).filter((m: Row) => ['active', 'proposed'].includes(m.status) && (!m.expiresAt || new Date(m.expiresAt).getTime() > Date.now())).map((m: Row) => <article key={m.memoryId} className="player-memory"><small>{m.status === 'proposed' ? 'Suggestion' : 'Saved'} · {String(m.category).replaceAll('_', ' ')}</small><p>{m.text}</p>{m.sourceQuote && <blockquote>{m.sourceQuote}</blockquote>}<div className="player-actions">{m.status === 'proposed' && <button disabled={sending} onClick={() => memoryCommand('confirm', { memoryId: m.memoryId })}>Save</button>}<button disabled={sending} onClick={() => memoryCommand('forget', { memoryId: m.memoryId })}>Forget</button></div></article>)}
        <p>Forgetting stops older chats from recalling these details. Your chat and workout history stay available.</p>
        <button disabled={sending} onClick={() => { if (window.confirm('Forget all saved coach memories and suggestions?')) memoryCommand('forgetAll'); }}>Forget all memories</button>
      </>}
    </section>}
    <div className="player-chat-messages" ref={messageRoot} aria-live="polite">
      {!messages.length && !historyLoading && <div className="player-chat-welcome"><span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span><h2>{capability === 'workout_chat' ? context?.workoutRef?.kind === 'new' ? 'Make a session that fits today.' : 'What would you like to change?' : capability === 'coaching_chat' ? 'Get clear on this drill.' : 'What do you want to work on?'}</h2><p>{capability === 'workout_chat' ? 'Describe your time, equipment, or focus. Review the proposal before saving it.' : 'Ask about your progress, your next session, or a drill.'}</p><div className="player-suggestions">{coachPrompts(capability, context?.workoutRef).map(s => <button type="button" key={s} onClick={() => setDraft(s)}>{s}<span aria-hidden="true">↗</span></button>)}</div><small>Choose a suggestion to edit it before sending.</small></div>}
      {messages.map((m, i) => <article key={m.id || i} className={`chat-message ${m.role === 'user' ? 'user' : 'assistant'}`}><MultilineText text={m.content || ''} />{onHandoff && m.role === 'assistant' && validHandoff(m.workoutRequest, playerId) && (m.workoutRequest.destination === 'personal_workout' && personalStore && athlete ? <CoachPersonalWorkout playerId={playerId} athlete={athlete} preview={preview} store={personalStore} config={config} request={{ ...m.workoutRequest, ...(conversation.current && m.id ? { originConversationId: conversation.current, originMessageId: m.id } : {}) }} reference={m.personalWorkoutProposal} active={active && !sending && !error && i === messages.length - 1} onReview={onHandoff} /> : !sending && !error && i === messages.length - 1 && <button className="primary-cta" onClick={() => onHandoff(m.workoutRequest)}>Continue in Training</button>)}</article>)}
      {answer && <article className="chat-message assistant">{error && <small>Interrupted reply · check history for the saved version</small>}<MultilineText text={answer} /></article>}
      {sending && <p role="status">{status || 'Your coach is thinking…'}</p>}
      {historyLoading && <p role="status">Loading your conversation…</p>}
    </div>
    {error && <div className="player-error" role="alert"><p>{error}</p>{conversation.current && <button type="button" disabled={sending} onClick={() => void openHistory({ id: conversation.current, workoutTarget: context?.workoutRef })}>Load saved conversation</button>}</div>}
    {!canChat && <p>{config ? 'Your coach is temporarily unavailable. Your history is still here.' : 'Connecting to your coach…'}</p>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(draft.trim()); }}>
      <textarea aria-label="Message your coach" value={draft} onChange={e => setDraft(e.target.value)} maxLength={capability === 'workout_chat' ? 500 : 2000} placeholder="Message your coach…" rows={2} disabled={sending || historyLoading} />
      <button type="submit" disabled={!canChat || sending || historyLoading || !draft.trim()} aria-label="Send message"><span className="material-symbols-outlined">arrow_upward</span></button>
    </form>
    {sending && <button className="text-button" onClick={() => controller.current?.abort()}>Stop reply</button>}
  </section>;
}

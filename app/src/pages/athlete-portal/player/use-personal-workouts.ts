import { useEffect, useRef, useState } from 'react';
import firebase, { auth, db } from '../../../lib/firebase';
import { normalizeCatalogDrill } from '../../../lib/contracts/drillV2';
import type { CatalogDrill } from '../../../lib/contracts/drillV2';
import type { Row } from './execution';
import type { PlayerWorkoutStore } from './use-player-workouts';
import { addPersonalDrill, eligiblePersonalDrill, ensurePersonalSubmission, latestPersonalRevision, personalCapabilityEnabled, personalDraft, personalExecution, personalExecutionId, personalGenerationErrors, personalJobKey, personalLogRows, personalWorkoutsEnabled, recomputePersonalDraft, restorePersonalJob } from './personal-workouts';
import type { PendingPersonalJob, PersonalCapability } from './personal-workouts';
import { checkedPersonalConversation, checkedPersonalProposal, orderedPersonalMessages, personalProposalWithPublication, personalPublishParams, personalRefinementParams, personalTimestamp, publishedPersonalWorkoutId, readPersonalConversation, restorePersonalSelection } from './personal-workout-conversations';
import type { PersonalSelection } from './personal-workout-conversations';
import { confirmedSetup, setupFromIntake } from './training-access';

const sampleCatalog = [
  { drillId: 'SPD-SAMPLE', name: 'Quick feet practice', domain: 'speed', equipment: [] },
  { drillId: 'STR-SAMPLE', name: 'Bodyweight control', domain: 'strength', equipment: [] },
  { drillId: 'AGL-SAMPLE', name: 'Controlled direction changes', domain: 'agility', equipment: ['cones'] },
  { drillId: 'DRB-005', name: 'Cone maze', domain: 'dribbling', equipment: ['ball', 'cones'] },
  { drillId: 'PAS-001', name: 'Wall pass rhythm', domain: 'passing', equipment: ['ball', 'wall'] },
  { drillId: 'BMA-001', name: 'Close-control touches', domain: 'ballMastery', equipment: ['ball'] },
].map(d => normalizeCatalogDrill(d.drillId, { ...d, schemaVersion: 2, status: 'published', minAge: 5, maxAge: 80, difficultyLevel: 1, maxFrequencyPerWeek: 7, dose: { setsMin: 1, setsMax: 4, repsMin: 20, repsMax: 90, repUnit: 'seconds', restSecondsMin: 15, restSecondsMax: 60 }, howTo: { setup: 'Use an open, safe space.', steps: ['Keep each repetition controlled.'] } }));

export function usePersonalWorkouts(playerId: string, preview: boolean, config: Row | null) {
  const enabled = personalWorkoutsEnabled(config, preview);
  const [workouts, setWorkouts] = useState<Row[]>([]), [logs, setLogs] = useState<Record<string, Row>>({});
  const [catalog, setCatalog] = useState<CatalogDrill[]>(preview ? sampleCatalog : []);
  const [scheduleRevision, setScheduleRevision] = useState<number | null>(preview ? 0 : null);
  const [loaded, setLoaded] = useState(preview), [saving, setSaving] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [pending, setPending] = useState<PendingPersonalJob | null>(null), [proposal, setProposal] = useState<Row | null>(null);
  const [lastResult, setLastResult] = useState<{ capability: PersonalCapability; result: Row } | null>(null);
  const [conversations, setConversations] = useState<Row[]>([]), [conversationsLoaded, setConversationsLoaded] = useState(preview);
  const [conversationId, setConversationId] = useState<string | null>(null), [conversation, setConversation] = useState<Row | null>(null);
  const [messages, setMessages] = useState<Row[]>([]), [conversationLoading, setConversationLoading] = useState(false);
  const samples = useRef(new Map<string, { conversation: Row; proposal: Row; messages: Row[] }>());
  const selected = useRef<{ conversation: Row | null; proposal: Row | null }>({ conversation: null, proposal: null });
  const selectionVersion = useRef(0);
  const current = useRef({ workouts, logs, scheduleRevision }); current.current = { workouts, logs, scheduleRevision };
  const busy = useRef(false), generation = useRef(0), subscriptions = useRef<(() => void)[]>([]);
  const uid = auth.currentUser?.uid || '', key = personalJobKey(uid, playerId), proposalKey = `${key}:proposal`;
  const selectionScope = JSON.stringify([uid, playerId, preview, enabled]);
  const [initializedSelectionScope, setInitializedSelectionScope] = useState<string | null>(null);
  const selectionReady = enabled && initializedSelectionScope === selectionScope;
  const conversationPort = {
    conversation: async (id: string) => (await db.collection('players').doc(playerId).collection('aiConversations').doc(id).get({ source: 'server' })).data() || null,
    proposal: async (id: string) => (await db.collection('players').doc(playerId).collection('personalWorkoutProposals').doc(id).get({ source: 'server' })).data() || null,
    messages: async (id: string) => (await db.collection('players').doc(playerId).collection('aiConversations').doc(id).collection('messages').get({ source: 'server' })).docs.map(d => ({ ...d.data(), id: d.id })),
  };
  const persistSelection = (value: { conversationId?: string; proposalId?: string } | null) => {
    if (preview) return;
    try {
      if (value) localStorage.setItem(proposalKey, JSON.stringify({ schemaVersion: 1, uid, playerId, ...value } satisfies PersonalSelection));
      else localStorage.removeItem(proposalKey);
    } catch { /* The server conversation remains available in history. */ }
  };
  const applySelection = (next: { conversation: Row | null; proposal: Row | null; messages: Row[] }) => {
    const proposal = personalProposalWithPublication(next.proposal, next.conversation);
    selected.current = { conversation: next.conversation, proposal };
    setConversation(next.conversation); setConversationId(next.conversation?.conversationId || null);
    setProposal(proposal); setMessages(next.messages);
    persistSelection(next.proposal ? { ...(next.conversation ? { conversationId: next.conversation.conversationId } : {}), proposalId: next.proposal.proposalId } : null);
  };
  const openConversation = async (id: string): Promise<Row> => {
    const version = ++selectionVersion.current, owner = generation.current;
    setConversationLoading(true); setError('');
    try {
      const next = preview ? samples.current.get(id) : await readPersonalConversation(conversationPort, id, uid);
      if (!next) throw new Error('This sample workout conversation is unavailable.');
      if (version !== selectionVersion.current || owner !== generation.current || !preview && auth.currentUser?.uid !== uid) throw new Error('The selected workout conversation changed.');
      applySelection(next);
      return next.proposal;
    } catch (e: any) { if (version === selectionVersion.current && owner === generation.current) setError(e.message); throw e; }
    finally { if (version === selectionVersion.current && owner === generation.current) setConversationLoading(false); }
  };
  const openProposal = async (id: string): Promise<Row> => {
    const version = ++selectionVersion.current, owner = generation.current;
    setConversationLoading(true); setError('');
    try {
      const sample = preview ? [...samples.current.values()].find(row => row.proposal.proposalId === id) : undefined;
      if (preview && !sample) throw new Error('This sample workout proposal is unavailable.');
      const recovered = sample?.proposal || checkedPersonalProposal(await conversationPort.proposal(id), id, uid);
      const next = sample || (recovered.conversationId ? await readPersonalConversation(conversationPort, recovered.conversationId, uid) : { conversation: null, proposal: recovered, messages: [] });
      if (version !== selectionVersion.current || owner !== generation.current || !preview && auth.currentUser?.uid !== uid) throw new Error('The selected workout conversation changed.');
      applySelection(next);
      return next.proposal;
    } catch (e: any) { if (version === selectionVersion.current && owner === generation.current) setError(e.message); throw e; }
    finally { if (version === selectionVersion.current && owner === generation.current) setConversationLoading(false); }
  };
  const newConversation = () => {
    if (busy.current) { setError('Wait for the current workout request before starting another.'); return; }
    ++selectionVersion.current; applySelection({ conversation: null, proposal: null, messages: [] }); setConversationLoading(false); setError(''); setLastResult(null);
  };
  const savePending = (p: PendingPersonalJob | null) => {
    if (p) localStorage.setItem(key, JSON.stringify(p)); else localStorage.removeItem(key);
    setPending(p);
  };
  const readPending = () => { try { return restorePersonalJob(JSON.parse(localStorage.getItem(key) || 'null'), uid, playerId); } catch { return null; } };
  const accept = (capability: PersonalCapability, result: Row) => {
    const effective = { ...result };
    if (result.workout?.schemaVersion === 1 && result.workoutId) {
      effective.workout = latestPersonalRevision(current.current.workouts.find(w => w.workoutId === result.workoutId), { ...result.workout, id: result.workoutId });
      current.current.workouts = [...current.current.workouts.filter(w => w.workoutId !== result.workoutId), effective.workout];
      setWorkouts(current.current.workouts);
    }
    if (result.log?.schemaVersion === 1) {
      const id = result.log.workoutId;
      effective.log = latestPersonalRevision(current.current.logs[id], result.log);
      current.current.logs = { ...current.current.logs, [id]: effective.log };
      setLogs(current.current.logs);
    }
    if (Number.isInteger(result.scheduleRevision)) { effective.scheduleRevision = Math.max(current.current.scheduleRevision || 0, result.scheduleRevision); current.current.scheduleRevision = effective.scheduleRevision; setScheduleRevision(effective.scheduleRevision); }
    if (capability === 'generate_personal_workout' && result.proposalId) {
      const proposal = personalProposalWithPublication(result, selected.current.conversation);
      setProposal(proposal);
      selected.current.proposal = proposal;
      persistSelection({ proposalId: result.proposalId, ...(result.conversationId ? { conversationId: result.conversationId } : {}) });
    }
    setLastResult({ capability, result: effective });
    return effective;
  };
  const runPending = async (record: PendingPersonalJob): Promise<Row> => {
    if (busy.current) throw new Error('Wait for the current workout action to finish.');
    if (!personalCapabilityEnabled(config, record.capability, preview) || !uid || auth.currentUser?.uid !== record.uid) throw new Error('This workout action is unavailable. Return to Training and sign in again.');
    busy.current = true; setSaving(true); setError(''); setStatus('Checking your request…');
    const token = generation.current, selectedVersion = selectionVersion.current;
    let terminal = false;
    try {
      // Persist the chosen ID before the create. A lost acknowledgement can
      // therefore be recovered without submitting a second accepted action.
      const ref = db.collection('llmJobs').doc(record.jobId);
      await ensurePersonalSubmission(record, { persist: savePending, exists: async () => {
        const found = await ref.get({ source: 'server' }), job = found.data();
        if (found.exists && (job?.requestedByUid !== uid || job?.playerId !== playerId || job?.capability !== record.capability || job?.params?.requestId !== record.params.requestId)) throw new Error('The saved request does not match this workout action.');
        return found.exists;
      },
        create: async () => { await ref.set({ schemaVersion: 1, capability: record.capability, playerId,
          params: record.params, requestedByUid: uid, clientVersion: 'web-personal-workouts-v1', status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() }); } });
      if (generation.current !== token || auth.currentUser?.uid !== uid) throw new Error('The selected player changed.');
      const result = await new Promise<Row>((resolve, reject) => {
        const stop = ref.onSnapshot(snapshot => {
          const job = snapshot.data();
          if (!job) return;
          if (job.status === 'failed') { terminal = true; stop(); reject(new Error(job.error?.detail || job.error?.message || 'This workout could not be checked. Review your details and try again.')); }
          else if (job.status === 'complete') { terminal = true; stop(); resolve(job.result || {}); }
          else if (generation.current === token) setStatus(job.status === 'running' ? record.capability === 'generate_personal_workout' ? 'Building a workout to review…' : 'Checking and saving…' : 'Request received. Waiting for a check…');
        }, e => { stop(); reject(e); });
        subscriptions.current.push(() => { stop(); reject(new Error('The selected player changed.')); });
      });
      if (generation.current !== token || auth.currentUser?.uid !== uid) throw new Error('The selected player changed.');
      // A completed job is a recovery receipt. Read the authoritative proposal
      // and current conversation head, rather than caching its result payload.
      if (record.capability === 'generate_personal_workout' && selectionVersion.current !== selectedVersion) {
        // Back/history can change the active conversation while the accepted
        // job completes. Its server history remains recoverable, without
        // replacing the conversation the athlete has since chosen.
        savePending(null); setStatus(''); return result;
      }
      const confirmed = record.capability === 'generate_personal_workout' && result.proposalId ? await openProposal(result.proposalId) : result;
      const effective = accept(record.capability, confirmed);
      savePending(null); setStatus(''); return effective;
    } catch (e: any) {
      if (generation.current === token) {
        if (terminal || e.definitiveRejection) { try { savePending({ ...record, terminalFailed: true }); } catch { /* preserve the existing recovery receipt */ } }
        setError(e.message || 'Connection interrupted. Retry the saved request to recover its result.');
      }
      throw e;
    } finally { if (generation.current === token) { busy.current = false; setSaving(false); } }
  };
  useEffect(() => {
    const token = ++generation.current;
    ++selectionVersion.current;
    setInitializedSelectionScope(null);
    busy.current = false; setSaving(false); setStatus('');
    selected.current = { conversation: null, proposal: null }; setConversation(null); setConversationId(null); setMessages([]); setConversationLoading(false); setConversations([]); setConversationsLoaded(preview);
    if (!enabled) { current.current = { workouts: [], logs: {}, scheduleRevision: null }; setWorkouts([]); setLogs({}); setScheduleRevision(null); setLoaded(false); setProposal(null); setPending(null); setLastResult(null); return; }
    if (preview) { setCatalog(sampleCatalog); setLoaded(true); setScheduleRevision(0); setInitializedSelectionScope(selectionScope); return; }
    current.current = { workouts: [], logs: {}, scheduleRevision: null };
    setWorkouts([]); setLogs({}); setLoaded(false); setScheduleRevision(null); setProposal(null); setPending(null); setLastResult(null); setError('');
    const player = db.collection('players').doc(playerId);
    const stops = [
      player.collection('personalWorkouts').onSnapshot(s => { current.current.workouts = s.docs.map(d => latestPersonalRevision(current.current.workouts.find(w => w.workoutId === d.id), { ...d.data(), id: d.id })); setWorkouts(current.current.workouts); setLoaded(true); }, e => setError(e.message)),
      player.collection('personalWorkoutLogs').onSnapshot(s => { current.current.logs = Object.fromEntries(s.docs.map(d => [d.id, latestPersonalRevision(current.current.logs[d.id], { ...d.data(), id: d.id })])); setLogs(current.current.logs); }, e => setError(e.message)),
      player.collection('workoutSchedule').doc('current').onSnapshot(d => { current.current.scheduleRevision = Math.max(current.current.scheduleRevision || 0, Number(d.data()?.revision || 0)); setScheduleRevision(current.current.scheduleRevision); }, e => setError(e.message)),
      db.collection('drillCatalog').where('status', '==', 'published').onSnapshot(s => setCatalog(s.docs.map(d => normalizeCatalogDrill(d.id, d.data()))), e => setError(e.message)),
      player.collection('aiConversations').where('capability', '==', 'generate_personal_workout').where('createdByUid', '==', uid).onSnapshot(s => {
        if (generation.current !== token) return;
        setConversations(s.docs.map(d => ({ ...d.data(), id: d.id, conversationId: d.id })).sort((a: Row, b: Row) => personalTimestamp(b.lastMessageAt) - personalTimestamp(a.lastMessageAt)));
        setConversationsLoaded(true);
      }, e => { setConversationsLoaded(true); setError(`Workout conversations: ${e.message}`); }),
    ];
    const recovery = readPending();
    try {
      const saved = restorePersonalSelection(JSON.parse(localStorage.getItem(proposalKey) || 'null'), uid, playerId);
      // An accepted generation will select its own confirmed result on recovery.
      if (saved && !(recovery?.capability === 'generate_personal_workout' && !recovery.terminalFailed)) {
        void (saved.conversationId ? openConversation(saved.conversationId) : openProposal(saved.proposalId!)).catch(() => {});
      }
    } catch { /* A corrupt unsaved proposal is never treated as an executable workout. */ }
    if (recovery) { setPending(recovery); if (!recovery.terminalFailed) void runPending(recovery).catch(() => {}); }
    // Child route effects run before this owner initialization effect. Let the
    // explicit URL select only after receipt recovery has started, so it cannot
    // be invalidated by initialization or replaced by a different saved draft.
    setInitializedSelectionScope(selectionScope);
    return () => { if (generation.current === token) generation.current++; stops.forEach(s => s()); subscriptions.current.splice(0).forEach(s => s()); busy.current = false; };
  }, [playerId, preview, enabled, uid]);
  useEffect(() => {
    if (!conversationId || preview || !enabled) return;
    let alive = true, headVersion = 0;
    const base = db.collection('players').doc(playerId).collection('aiConversations').doc(conversationId);
    const stopConversation = base.onSnapshot(snapshot => {
      if (!alive || selected.current.conversation?.conversationId !== conversationId) return;
      const token = ++headVersion;
      try {
        const next = checkedPersonalConversation(snapshot.data() || null, conversationId, uid);
        if (Number(selected.current.conversation?.proposalRevision || 0) > next.proposalRevision) return;
        selected.current.conversation = next; setConversation(next);
        if (selected.current.proposal?.proposalId !== next.latestProposalId) {
          setConversationLoading(true);
          void conversationPort.proposal(next.latestProposalId).then(raw => {
            if (!alive || token !== headVersion || selected.current.conversation?.conversationId !== conversationId) return;
            const checked = checkedPersonalProposal(raw, next.latestProposalId, uid, next);
            const confirmed = personalProposalWithPublication(checked, next);
            selected.current.proposal = confirmed; setProposal(confirmed); persistSelection({ conversationId, proposalId: checked.proposalId });
          }).catch(e => { if (alive && token === headVersion) setError(e.message); }).finally(() => { if (alive && token === headVersion) setConversationLoading(false); });
        } else {
          const confirmed = personalProposalWithPublication(selected.current.proposal, next);
          selected.current.proposal = confirmed; setProposal(confirmed);
        }
      } catch (e: any) { if (alive) setError(e.message); }
    }, e => { if (alive) setError(e.message); });
    const stopMessages = base.collection('messages').onSnapshot(s => {
      if (alive && selected.current.conversation?.conversationId === conversationId) setMessages(orderedPersonalMessages(s.docs.map(d => ({ ...d.data(), id: d.id }))));
    }, e => { if (alive) setError(e.message); });
    return () => { alive = false; ++headVersion; stopConversation(); stopMessages(); };
  }, [conversationId, playerId, uid, enabled, preview]);
  const perform = async (capability: PersonalCapability, params: Row): Promise<Row> => {
    if (!personalCapabilityEnabled(config, capability, preview)) throw new Error('This workout action is not enabled yet.');
    if (preview) throw new Error('Sample workout actions must use the in-memory preview.');
    const signature = JSON.stringify({ capability, params });
    const old = readPending();
    if (old && !old.terminalFailed && old.signature !== signature) throw new Error('Recover the previous request before making another change.');
    const record: PendingPersonalJob = old?.signature === signature && !old.terminalFailed ? old : {
      schemaVersion: 1, uid, playerId, capability, signature,
      jobId: db.collection('llmJobs').doc().id,
      params: { ...params, requestId: old?.signature === signature ? old.params.requestId : crypto.randomUUID() },
    };
    return runPending(record);
  };
  const clearProposal = () => { selected.current.proposal = null; setProposal(null); persistSelection(null); };
  const save = async (params: Row) => {
    if (preview) {
      const workoutId = params.workoutId || `sample-${crypto.randomUUID()}`, revision = Number(params.expectedRevision || 0) + 1;
      const origin = [...samples.current.values()].find(entry => entry.proposal.proposalId === params.proposalId);
      const workout = { ...params.workout, schemaVersion: 1, source: 'personal', playerId, workoutId, revision, status: 'ready', scheduledDate: params.scheduledDate, timezone: params.timezone, intake: params.intake, sourceWorkout: params.sourceWorkout || null,
        ...(origin ? { personalConversationId: origin.conversation.conversationId, personalProposalId: params.proposalId } : {}) };
      const result = accept('save_personal_workout', { workoutId, revision, workout, scheduleRevision: (current.current.scheduleRevision || 0) + 1 }); clearProposal(); return result;
    }
    const result = await perform('save_personal_workout', params); clearProposal(); return result;
  };
  const generate = async (params: Row): Promise<Row> => {
    const errors = personalGenerationErrors(params.intake, params.timeAvailableMinutes, params.requestText);
    if (errors.length) throw new Error(errors.join(' '));
    if (!preview) return perform('generate_personal_workout', params);
    const before = params.conversationId ? samples.current.get(params.conversationId) : undefined;
    if (params.conversationId && (!before || before.proposal.proposalId !== params.baseProposalId)) throw new Error('Reopen the latest sample workout before changing it.');
    const id = before?.conversation.conversationId || `sample-conversation-${crypto.randomUUID()}`;
    const revision = Number(before?.conversation.proposalRevision || 0) + 1;
    const available = sampleCatalog.filter(d => eligiblePersonalDrill(d, params.intake) && (!params.intake.focusDomains?.length || params.intake.focusDomains.includes(d.domain)));
    if (!available.length) throw new Error('Select equipment for a sample workout, such as a ball.');
    const asked = String(params.requestText).toLowerCase();
    const included = available.filter(d => !(asked.includes('no wall') || asked.includes('remove') && asked.includes('wall')) || !d.equipment.includes('wall'));
    if (!included.length) throw new Error('This sample needs at least one suitable drill.');
    let workout = personalDraft(before?.proposal.workout, true);
    if (!before) for (const drill of included.slice(0, 3)) workout = addPersonalDrill(workout, drill);
    else workout.blocks = workout.blocks.filter(block => included.some(d => d.drillId === block.drillId));
    if (asked.includes('add')) for (const drill of included) if (!workout.blocks.some(b => b.drillId === drill.drillId)) { workout = addPersonalDrill(workout, drill); break; }
    const targetBlockMinutes = Math.max(1, (params.timeAvailableMinutes - Math.max(0, workout.blocks.length - 1)) / Math.max(1, workout.blocks.length));
    workout = recomputePersonalDraft({ ...workout, title: before?.proposal.workout.title || 'Your focused practice', budgetMinutes: params.timeAvailableMinutes,
      intent: 'Sample workout for reviewing the conversation and publishing flow.', blocks: workout.blocks.map(b => ({ ...b, sets: 4,
        reps: Math.max(20, Math.min(90, Math.floor((targetBlockMinutes * 60 - 90) / 4))), restSeconds: 30 })) });
    const proposalId = `sample-proposal-${crypto.randomUUID()}`, now = new Date();
    const nextProposal = { ...params, schemaVersion: 1, proposalId, conversationId: id, baseProposalId: params.baseProposalId || null,
      proposalRevision: revision, requestedMinutes: params.timeAvailableMinutes, createdByUid: uid, createdAt: now,
      expiresAt: new Date(now.getTime() + 86400000), workout, check: { ok: true },
      assistantMessage: 'Here is a sample workout. Ask for a change, or publish when you are ready.' };
    const nextConversation = { ...(before?.conversation || {}), id, conversationId: id, capability: 'generate_personal_workout', createdByUid: uid,
      title: before?.conversation.title || params.requestText.slice(0, 60), createdAt: before?.conversation.createdAt || now,
      latestProposalId: proposalId, proposalRevision: revision, lastMessageAt: now, messageCount: revision * 2 };
    const next = { conversation: nextConversation, proposal: nextProposal, messages: [...(before?.messages || []),
      { id: `${proposalId}_user`, role: 'user', content: params.requestText, createdAt: now, sequence: revision * 2 - 1 },
      { id: `${proposalId}_assistant`, role: 'assistant', content: nextProposal.assistantMessage, proposalId, createdAt: now, sequence: revision * 2 }] };
    samples.current.set(id, next); applySelection(next); setConversations([...samples.current.values()].map(value => value.conversation));
    return accept('generate_personal_workout', nextProposal);
  };
  const refine = async (requestText: string, overrides: Row = {}): Promise<Row> => {
    const active = selected.current.proposal, owner = generation.current, version = selectionVersion.current;
    if (!active) throw new Error('Open a workout proposal before asking for changes.');
    if (busy.current) throw new Error('Wait for the current workout request to finish.');
    const params = personalRefinementParams(active, requestText, { ...overrides, expectedScheduleRevision: current.current.scheduleRevision });
    const workoutId = publishedPersonalWorkoutId(active, selected.current.conversation);
    if (workoutId) {
      const [workout, log] = preview ? [current.current.workouts.find(w => w.workoutId === workoutId), current.current.logs[workoutId]] :
        await Promise.all(['personalWorkouts', 'personalWorkoutLogs'].map(async path => (await db.collection('players').doc(playerId).collection(path).doc(workoutId).get({ source: 'server' })).data()));
      if (owner !== generation.current || version !== selectionVersion.current || !preview && auth.currentUser?.uid !== uid) throw new Error('The selected workout or player changed.');
      if (log) throw new Error('This workout has started. Create a new personal copy to make changes.');
      if (!workout || workout.source !== 'personal' || !Number.isInteger(workout.revision)) throw new Error('The saved workout could not be loaded. Reopen Personal workouts.');
      params.workoutId = workoutId; params.expectedRevision = workout.revision;
    }
    // Keep the last confirmed workout visible throughout generation and failure.
    return generate(params);
  };
  const assess = async (params: Row): Promise<Row> => {
    if (!preview) {
      if (!personalCapabilityEnabled(config, 'assess_personal_workout') || !uid || auth.currentUser?.uid !== uid) throw new Error('Workout setup checks are unavailable. Refresh Training and try again.');
      const assessmentKey = `${key}:assessment`, signature = JSON.stringify({ capability: 'assess_personal_workout', params });
      let previous: PendingPersonalJob | null = null;
      try { previous = restorePersonalJob(JSON.parse(localStorage.getItem(assessmentKey) || 'null'), uid, playerId); } catch { /* ignore an invalid receipt */ }
      const record: PendingPersonalJob = previous?.signature === signature && !previous.terminalFailed ? previous : {
        schemaVersion: 1, uid, playerId, capability: 'assess_personal_workout', signature, jobId: db.collection('llmJobs').doc().id,
        params: { ...params, requestId: crypto.randomUUID() },
      };
      const ref = db.collection('llmJobs').doc(record.jobId), owner = generation.current;
      const result = await new Promise<Row>((resolve, reject) => {
        let settled = false, stop = () => {};
        const settle = (complete: () => void) => {
          if (settled) return; settled = true; clearTimeout(timeout); stop();
          const index = subscriptions.current.indexOf(cancel); if (index >= 0) subscriptions.current.splice(index, 1);
          complete();
        };
        const fail = (failure: any) => settle(() => reject(failure));
        const cancel = () => fail(new Error('The selected player changed.'));
        // Include the create acknowledgement in the limit. A queued Firestore
        // write can finish later; its durable ID remains available for Retry.
        const timeout = window.setTimeout(() => fail(new Error('Your setup check is taking longer than expected. Retry to recover the same check.')), 20000);
        subscriptions.current.push(cancel);
        void ensurePersonalSubmission(record, { persist: value => { try { localStorage.setItem(assessmentKey, JSON.stringify(value)); } catch { /* the job still has a stable identity this visit */ } },
          exists: async () => { const snapshot = await ref.get({ source: 'server' }), job = snapshot.data(); if (snapshot.exists && (job?.requestedByUid !== uid || job?.playerId !== playerId || job?.capability !== record.capability || job?.params?.requestId !== record.params.requestId)) throw new Error('The setup check does not match your account.'); return snapshot.exists; },
          create: async () => { await ref.set({ schemaVersion: 1, capability: record.capability, playerId, params: record.params, requestedByUid: uid,
            clientVersion: 'web-guided-workouts-v1', status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() }); } }).then(() => {
          if (settled) return;
          if (owner !== generation.current || auth.currentUser?.uid !== uid) { cancel(); return; }
          const unsubscribe = ref.onSnapshot(snapshot => {
            const job = snapshot.data();
            if (settled || !job) return;
            if (job.status === 'complete') settle(() => resolve(job.result || {}));
            else if (job.status === 'failed') {
              try { if (JSON.parse(localStorage.getItem(assessmentKey) || 'null')?.jobId === record.jobId) localStorage.setItem(assessmentKey, JSON.stringify({ ...record, terminalFailed: true })); } catch { /* optional recovery receipt */ }
              fail(new Error(job.error?.detail || job.error?.message || 'Your setup could not be checked. Try again.'));
            }
          }, fail);
          stop = unsubscribe; if (settled) stop();
        }).catch(fail);
      });
      if (owner !== generation.current || auth.currentUser?.uid !== uid) throw new Error('The selected player changed. Return to Training.');
      try { if (JSON.parse(localStorage.getItem(assessmentKey) || 'null')?.jobId === record.jobId) localStorage.removeItem(assessmentKey); } catch { /* optional recovery storage */ }
      return result;
    }
    const focusAvailability = params.intake.focusDomains.map((domain: string) => {
      const count = sampleCatalog.filter(d => d.domain === domain && eligiblePersonalDrill(d, { ...params.intake, age: params.intake.age || 15 })).length;
      return { domain, eligibleDrillCount: count, status: count ? 'available' : 'unavailable', reasonCodes: count ? [] : ['no_eligible_drills'] };
    });
    const supportedMinutes = focusAvailability.every((f: Row) => f.status === 'available') ? Array.from({ length: 56 }, (_, i) => i + 5) : [];
    return { schemaVersion: 1, resolvedAge: params.intake.age || null, ageSource: params.intake.age ? 'intake' : 'absent', scheduleRevision: current.current.scheduleRevision,
      catalogVersion: 'sample', focusDomains: params.intake.focusDomains, focusAvailability, supportedMinutes,
      recommendedMinutes: supportedMinutes.includes(params.timeAvailableMinutes) ? params.timeAvailableMinutes : supportedMinutes.length ? 20 : null,
      limitations: supportedMinutes.length ? [] : [{ code: 'no_eligible_drills', message: 'This sample does not include that focus for your current equipment. Change your focus or setup.' }] };
  };
  const publish = async (): Promise<Row> => {
    const active = selected.current.proposal, owner = generation.current, version = selectionVersion.current;
    if (!active) throw new Error('Review a workout proposal before publishing.');
    const next = preview ? { conversation: selected.current.conversation, proposal: active } : active.conversationId ?
      await readPersonalConversation(conversationPort, active.conversationId, uid) : { conversation: null, proposal: checkedPersonalProposal(await conversationPort.proposal(active.proposalId), active.proposalId, uid) };
    if (owner !== generation.current || version !== selectionVersion.current || !preview && auth.currentUser?.uid !== uid) throw new Error('The selected workout or player changed.');
    if (next.proposal.proposalId !== active.proposalId) {
      if ('messages' in next) applySelection(next);
      throw new Error('A newer workout proposal is available. Review it before publishing.');
    }
    // The saved marker is server owned, and allows safe recovery after a lost
    // publish acknowledgement without starting a second workout.
    const publishedId = publishedPersonalWorkoutId(next.proposal, next.conversation);
    if (publishedId) {
      const workoutId = publishedId;
      const workout = preview ? current.current.workouts.find(w => w.workoutId === workoutId) :
        (await db.collection('players').doc(playerId).collection('personalWorkouts').doc(workoutId).get({ source: 'server' })).data();
      if (owner !== generation.current || version !== selectionVersion.current || !preview && auth.currentUser?.uid !== uid) throw new Error('The selected workout or player changed.');
      if (!workout || workout.source !== 'personal') throw new Error('The published workout could not be loaded. Reopen Personal workouts.');
      return accept('save_personal_workout', { workoutId, workout, revision: workout.revision });
    }
    const params = personalPublishParams(next.proposal, next.conversation);
    const result = preview ? await save(params) : await perform('save_personal_workout', params);
    if (next.conversation && owner === generation.current && version === selectionVersion.current) {
      const updated: Row = { ...next.conversation, publishedWorkoutId: result.workoutId, publishedProposalId: active.proposalId };
      const entry = preview ? samples.current.get(updated.conversationId) : undefined;
      if (entry) { entry.conversation = updated; samples.current.set(updated.conversationId, entry); }
      const confirmed = personalProposalWithPublication(active, updated);
      selected.current = { conversation: updated, proposal: confirmed }; setProposal(confirmed); setConversation(updated);
      setConversations(rows => preview ? [...samples.current.values()].map(value => value.conversation) : rows.map(row => row.conversationId === updated.conversationId ? updated : row));
    }
    return result;
  };
  const start = async (workout: Row, confirmation: Row) => {
    const token = generation.current;
    if (!personalCapabilityEnabled(config, 'start_personal_workout', preview)) throw new Error('Starting personal workouts is not enabled.');
    if (confirmation.equipmentConfirmed !== true || confirmation.painFlag !== false) throw new Error('Confirm today’s equipment and pain-free training before continuing.');
    if (!confirmedSetup({ ...setupFromIntake(confirmation.currentAccess), confirmed: confirmation.currentAccess?.access?.confirmed === true })) throw new Error('Confirm today’s training setup before continuing.');
    let result: Row;
    if (preview) {
      const old = current.current.logs[workout.workoutId];
      if (old?.endedAt) throw new Error('This workout is finished. Customize a new copy to train again.');
      if ((old?.workoutSnapshot || workout).blocks.some((block: Row) => {
        const drill = sampleCatalog.find(d => d.drillId === block.drillId);
        return !drill || !eligiblePersonalDrill(drill, confirmation.currentAccess);
      })) throw new Error('Your current setup does not support this sample workout. Ask AI for a suitable revision or personal copy.');
      result = { log: old || { schemaVersion: 1, source: 'personal', workoutId: workout.workoutId, workoutRevision: workout.revision, workoutSnapshot: workout, revision: 1, startedAt: new Date(), endedAt: null, elapsedSeconds: 0, activeSeconds: 0, blocks: [] } };
      result = accept('start_personal_workout', result);
    } else {
      // Read the exact log before asking the server to recheck today's access.
      // The resume command returns its frozen snapshot without a new reservation.
      const saved = await db.collection('players').doc(playerId).collection('personalWorkoutLogs').doc(workout.workoutId).get({ source: 'server' });
      if (generation.current !== token || auth.currentUser?.uid !== uid) throw new Error('The selected player changed. Return to Training.');
      if (saved.exists) {
        const log = saved.data()!;
        if (log.endedAt) throw new Error('This workout is finished. Customize a new copy to train again.');
        result = await perform('start_personal_workout', { workoutId: workout.workoutId, expectedRevision: workout.revision, expectedScheduleRevision: current.current.scheduleRevision,
          expectedLogRevision: log.revision, equipmentConfirmed: confirmation.equipmentConfirmed, painFlag: confirmation.painFlag, currentAccess: confirmation.currentAccess });
      } else result = await perform('start_personal_workout', { workoutId: workout.workoutId, expectedRevision: workout.revision, expectedScheduleRevision: current.current.scheduleRevision, equipmentConfirmed: confirmation.equipmentConfirmed, painFlag: confirmation.painFlag, currentAccess: confirmation.currentAccess });
    }
    return personalExecution(workout, result.log);
  };
  const updateLog = async (id: string, blocks: Row[], elapsedSeconds: number | undefined, endReason?: string) => {
    const workoutId = id.startsWith('personal_') ? id.slice('personal_'.length) : id;
    const old = current.current.logs[workoutId];
    if (!old || old.endedAt) throw new Error('This workout is not active.');
    const seconds = Math.max(Number(old.elapsedSeconds || 0), Math.floor(elapsedSeconds ?? Number(old.elapsedSeconds || 0)));
    const reason = endReason ? blocks.some(b => b.skipReason === 'pain') ? 'pain' : endReason === 'completed' ? 'completed' : 'stopped' : undefined;
    if (preview) { accept('update_personal_workout_log', { log: { ...old, blocks, revision: old.revision + 1, elapsedSeconds: seconds, activeSeconds: seconds, ...(reason ? { endReason: reason, endedAt: new Date() } : {}) } }); return; }
    await perform('update_personal_workout_log', { workoutId, expectedLogRevision: old.revision, blocks: personalLogRows(blocks), elapsedSeconds: seconds, ...(reason ? { endReason: reason } : {}) });
  };
  const adapter: PlayerWorkoutStore = {
    workouts, logs: Object.fromEntries(Object.entries(logs).map(([id, log]) => [personalExecutionId(id), log])), logsLoaded: loaded, saving, error: error || null,
    logFor: id => current.current.logs[id.startsWith('personal_') ? id.slice('personal_'.length) : id] || null,
    start: w => start(w, { equipmentConfirmed: false, painFlag: true }),
    saveBlock: async (id, blockId, row, elapsedSeconds) => { try { const old = adapter.logFor(id); await updateLog(id, [...(old?.blocks || []).filter((b: Row) => b.blockId !== blockId), ...(row ? [row] : [])], elapsedSeconds); } catch (e: any) { setError(e.message); throw e; } },
    finish: async (id, reason, seconds) => { try { await updateLog(id, adapter.logFor(id)?.blocks || [], seconds, reason); } catch (e: any) { setError(e.message); throw e; } },
    beginWorkout: () => {}, updateBlock: () => {}, removeBlock: () => {}, endWorkout: () => {}, noteWorkout: () => {},
  };
  return { ownerUid: uid, enabled, workouts, logs, catalog, scheduleRevision, loaded, saving, error, status, pending, proposal, lastResult, clearProposal, save, start, adapter,
    conversations, conversationsLoaded, conversationId, conversation, messages, conversationLoading, selectionReady, openConversation, openProposal, newConversation, refine, publish,
    consumeResult: () => setLastResult(null),
    generate, assess,
    recover: () => pending ? runPending(pending).catch(() => {}) : Promise.resolve(),
    setError,
  };
}
export type PersonalWorkoutStore = ReturnType<typeof usePersonalWorkouts>;

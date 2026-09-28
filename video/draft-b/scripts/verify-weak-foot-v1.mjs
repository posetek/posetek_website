import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

// Independent evidence checks. No cloud reads, model calls, or data mutations.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/weak-foot-v1');
const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checks = [];
const check = (name, passed, observed) => checks.push({name, passed: Boolean(passed), observed});
const words = text => String(text).trim().replace(/\s+/g, ' ');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const usable = point => Array.isArray(point) && finite(point[0]) && finite(point[1]) && finite(point[3]) && point[3] >= .1;
const scalar = metric => finite(metric) ? metric : metric?.value;
const angle = (a, vertex, b, width, height) => {
  if (![a, vertex, b].every(usable)) return null;
  const u = [(a[0] - vertex[0]) * width, (a[1] - vertex[1]) * height];
  const v = [(b[0] - vertex[0]) * width, (b[1] - vertex[1]) * height];
  const denominator = Math.hypot(...u) * Math.hypot(...v);
  return denominator > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / denominator))) * 180 / Math.PI : null;
};
const thighTilt = (hip, knee, width, height) => {
  if (![hip, knee].every(usable)) return null;
  const x = (hip[0] - knee[0]) * width, y = (hip[1] - knee[1]) * height;
  return Math.hypot(x, y) > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, -y / Math.hypot(x, y)))) * 180 / Math.PI : null;
};
const expected = {
  'player1-right': {foot: 'right', frames: 965, backswing: 417, contact: 443, follow: 493, knee: 143.21318958022218},
  'player1-left': {foot: 'left', frames: 1004, backswing: 458, contact: 472, follow: 522, knee: 111.09476209746953},
  'player2-right': {foot: 'right', frames: 997, backswing: 532, contact: 542, follow: 592, knee: 139.81727501056096},
  'player2-left': {foot: 'left', frames: 968, backswing: 452, contact: 464, follow: 514, knee: 123.10438558935132},
};

try {
  const timing = await read('src/weak-foot-v1-timing.json');
  check('60 seconds / 1,800 frames / 30 fps', timing.duration === 60 && timing.duration_frames === 1800 && timing.fps === 30);
  const boundaries = [0, 120, 390, 660, 930, 1170, 1470, 1710, 1800];
  check('Approved scene boundaries tile the film', timing.scenes.length === 8 && timing.scenes.every((scene, i) => scene.start === boundaries[i] && scene.end === boundaries[i + 1]), timing.scenes);

  const payloadBytes = await fs.readFile(path.join(root, 'public/weak-foot-v1/poses.json'));
  const payload = JSON.parse(payloadBytes.toString('utf8'));
  const provenance = await read('output/weak-foot-v1/assets-manifest.json');
  check('Four anonymous records in right/left presentation order', JSON.stringify(payload.records.map(record => record.key)) === JSON.stringify(Object.keys(expected)));
  check('No personal names or private identifiers in pose payload', !/\b(?:guy|maurizio|marizio|playerId|playerDocId|uid|repId|storageFolder|downloadToken|access_token)\b/i.test(payloadBytes.toString('utf8')));
  check('Render payload matches private preparation receipt', provenance.renderPayloadSha256 === digest(payloadBytes) && provenance.remoteMutations === 0 && provenance.confidenceThreshold === .1);
  for (const record of payload.records) {
    const reference = expected[record.key];
    if (!reference) { check('Known record key', false, record.key); continue; }
    const label = record.key;
    check(`${label}: physical foot and source geometry`, record.foot === reference.foot && record.fps === 240 && record.width === 1280 && record.height === 720);
    check(`${label}: complete recorded interval`, record.frames.length === reference.frames && record.frames.every(frame => Array.isArray(frame) && frame.length === 33), record.frames.length);
    check(`${label}: source keyframes unchanged`, record.backswingFrame === reference.backswing && record.contactFrame === reference.contact && record.followThroughFrame === reference.follow);
    check(`${label}: phase order valid`, 0 <= record.backswingFrame && record.backswingFrame < record.contactFrame && record.contactFrame < record.followThroughFrame && record.followThroughFrame < record.frames.length);
    check(`${label}: finite coordinates or explicit missing landmarks`, record.frames.every(frame => frame.every(point => Array.isArray(point) && point.length >= 4 && finite(point[3]) && point[3] >= 0 && point[3] <= 1 && (finite(point[0]) && finite(point[1]) || point[0] === null && point[1] === null && point[3] === 0))));
    const frame = record.frames[record.backswingFrame];
    const support = record.foot === 'right' ? [23, 25, 27] : [24, 26, 28];
    const kicking = record.foot === 'right' ? [24, 26] : [23, 25];
    const knee = angle(...support.map(id => frame[id]), record.width, record.height);
    const thigh = thighTilt(...kicking.map(id => frame[id]), record.width, record.height);
    const confidence = Math.min(...support.map(id => frame[id]?.[3] ?? 0));
    check(`${label}: support knee reproducible at exact backswing frame`, finite(knee) && Math.abs(knee - reference.knee) < .1 && Math.abs(knee - scalar(record.metrics.supportKnee)) < .1, {sourceFrame: record.backswingFrame, computed: knee, recorded: scalar(record.metrics.supportKnee), minimumConfidence: confidence});
    check(`${label}: support-knee highlight has strong confidence`, confidence >= .9, confidence);
    check(`${label}: thigh tilt reproducible at exact backswing frame`, finite(thigh) && Math.abs(thigh - scalar(record.metrics.thighTilt)) < .1, {computed: thigh, recorded: scalar(record.metrics.thighTilt)});
    const receipt = provenance.records.find(item => item.key === record.key);
    check(`${label}: qualified nonduplicate original source`, receipt?.canonical?.resultStatus?.qualified === true && receipt?.canonical?.resultStatus?.duplicate === false);
    check(`${label}: physical side independently agrees`, receipt?.metrics?.orientation?.strikeFootField === record.foot && receipt?.metrics?.orientation?.derivedKickingSide === record.foot && receipt?.metrics?.orientation?.sideAgreement === 'agree');
    check(`${label}: no neighboring-frame substitution for displayed metrics`, ['supportKnee', 'thighTilt'].every(id => receipt?.metrics?.metricRows?.[id]?.valid === true && receipt.metrics.metricRows[id].athleteFrame === record.backswingFrame));
    const originalPoseBytes = await fs.readFile(path.join(output, 'private-source', record.key, 'pose.json'));
    check(`${label}: original pose checksum matches verified bucket receipt`, digest(originalPoseBytes) === receipt.source.find(item => item.name === 'pose.json')?.sha256);
    const raw = JSON.parse(originalPoseBytes.toString('utf8'));
    const originalFrames = Array.isArray(raw) ? raw : raw.frames;
    check(`${label}: every usable recorded joint retained without invention`, record.frames.every((frame, f) => frame.every((point, i) => {
      const sourceFrame = originalFrames[f];
      const sourcePoint = (Array.isArray(sourceFrame) ? sourceFrame : sourceFrame?.landmarks ?? sourceFrame?.pose)?.[i];
      const original = Array.isArray(sourcePoint) ? sourcePoint : sourcePoint ? [sourcePoint.x, sourcePoint.y, sourcePoint.z ?? 0, sourcePoint.visibility ?? sourcePoint.confidence ?? 1] : [null, null, null, 0];
      return point.slice(0, 4).every((value, axis) => value === original[axis] || value === null && !finite(original[axis]));
    })));
    const relativeMovie = record.video?.src;
    check(`${label}: sanitized media path`, typeof relativeMovie === 'string' && relativeMovie.startsWith('weak-foot-v1/') && !relativeMovie.includes('..') && !/\b(?:guy|maurizio|marizio)\b/i.test(relativeMovie), relativeMovie);
    if (typeof relativeMovie === 'string' && !relativeMovie.includes('..')) {
      const movie = path.join(root, 'public', relativeMovie);
      check(`${label}: proxy checksum matches preparation receipt`, digest(await fs.readFile(movie)) === receipt.proxy.sha256);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', movie], {encoding: 'utf8'}));
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      check(`${label}: complete silent 720p original-speed proxy`, video?.width === 1280 && video?.height === 720 && probe.streams.every(stream => stream.codec_type !== 'audio') && Math.abs(Number(probe.format.duration) - record.video.durationSeconds) <= 1 / 30 + .001 && Math.abs(Number(probe.format.duration) - Number(receipt.originalProbe.format.duration)) <= 1 / 30 + .001, {duration: Number(probe.format.duration), declaredDuration: record.video.durationSeconds, sourceDuration: receipt.originalProbe.format.duration, frameRate: video?.avg_frame_rate});
    }
  }
  check('Pose evidence payload SHA-256 recorded', true, digest(payloadBytes));

  const poseCode = await fs.readFile(path.join(root, 'src/WeakFootPoseV1.tsx'), 'utf8');
  const ast = ts.createSourceFile('WeakFootPoseV1.tsx', poseCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ['visible', 'BONES', 'median', 'boneLengths', 'pairProjection', 'poseIndex', 'PosePair'].map(name => {
    const fn = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    if (fn) return fn.getText(ast).replace(/^export\s+/, '');
    const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(item => [...item.declarationList.declarations]).find(item => item.name.getText(ast) === name);
    if (!declaration) throw Error(`Missing pose geometry function: ${name}`);
    return `const ${declaration.getText(ast)};`;
  }).join('\n');
  const skeletonTag = Symbol('KickSkeleton');
  const geometry = vm.runInNewContext(ts.transpileModule(declarations, {compilerOptions: {target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}}).outputText + ';({visible,pairProjection,poseIndex,PosePair})', {Math, Number, WK: {line: '#254036', ink: '#f0f5ed', lime: '#b7f34a', mint: '#a8e4d7'}, KickSkeleton: skeletonTag, React: {createElement: (type, props, ...children) => ({type, props: props ?? {}, children})}});
  const renderedSkeletons = node => !node ? [] : Array.isArray(node) ? node.flatMap(renderedSkeletons) : typeof node !== 'object' ? [] : [...(node.type === skeletonTag ? [node.props] : []), ...(node.children ?? []).flatMap(renderedSkeletons)];
  check('Renderer applies native visibility threshold', !geometry.visible([.5, .5, 0, .09999]) && geometry.visible([.5, .5, 0, .1]) && !geometry.visible([null, .5, 0, 1]) && !geometry.visible([NaN, .5, 0, 1]));
  for (let offset = 0; offset < 4; offset += 2) {
    const pair = payload.records.slice(offset, offset + 2);
    for (const [width, height] of [[412, 470], [388, 600]]) {
      const projections = geometry.pairProjection(pair, width, height);
      const bounds = pair.map((record, i) => {
        const frames = record.frames.slice(Math.floor(record.contactFrame - record.fps * .2), Math.ceil(record.contactFrame + record.fps * .4) + 1);
        frames.push(record.frames[record.backswingFrame]);
        const points = frames.flat().filter(geometry.visible).map(projections[i].point);
        return {minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])), minY: Math.min(...points.map(point => point[1])), maxY: Math.max(...points.map(point => point[1]))};
      });
      check(`${pair[0].key.split('-')[0]}: complete tracked figure fits ${width}×${height} comparison cells`, bounds.every(b => b.minX >= 13 && b.maxX <= width - 13 && b.minY >= 13 && b.maxY <= height - 13), bounds);
      const phaseProjections = geometry.pairProjection(pair, width, height, true);
      const phaseBounds = pair.map((record, i) => {
        const points = record.frames[record.backswingFrame].filter(geometry.visible).map(phaseProjections[i].point);
        return {minX: Math.min(...points.map(point => point[0])), maxX: Math.max(...points.map(point => point[0])), minY: Math.min(...points.map(point => point[1])), maxY: Math.max(...points.map(point => point[1]))};
      });
      check(`${pair[0].key.split('-')[0]}: enlarged paused figures and highlights fit ${width}×${height}`, phaseBounds.every(b => b.minX >= 13 && b.maxX <= width - 13 && b.minY >= 13 && b.maxY <= height - 13), phaseBounds);
    }
    check(`${pair[0].key.split('-')[0]}: quarter-speed source timing`, pair.every(record => Array.from({length: 71}, (_, i) => geometry.poseIndex(record, -.2 + (i + 1) / 30 * .25) - geometry.poseIndex(record, -.2 + i / 30 * .25)).every(delta => delta === 2)));
    check(`${pair[0].key.split('-')[0]}: feedback holds exact source poses across time and metric changes`, [-.2, 0, .4, 3, 8].every(seconds => ['supportKnee', 'thighTilt'].every(metric => {
      const skeletons = renderedSkeletons(geometry.PosePair({pair, seconds, paused: true, metric}));
      return skeletons.length === 2 && skeletons.every((skeleton, i) => skeleton.points === pair[i].frames[pair[i].backswingFrame]);
    })));
  }

  const composition = await fs.readFile(path.join(root, 'src/WeakFootInvestorV1.tsx'), 'utf8');
  const compositionAst = ts.createSourceFile('WeakFootInvestorV1.tsx', composition, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stateSource = compositionAst.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'weakFootComparisonState').getText(compositionAst).replace(/^export\s+/, '');
  const comparisonState = vm.runInNewContext(ts.transpileModule(stateSource, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText + ';weakFootComparisonState', {Math, timing, ease: (frame, start, end) => {const u = Math.max(0, Math.min(1, (frame - start) / (end - start))); return u * u * (3 - 2 * u);}});
  const firstPaused = timing.comparison.play_frames + timing.comparison.phase_transition_frames;
  check('Feedback remains paused through both comparison scenes', [1, 2].every(player => Array.from({length: (player === 1 ? 270 : 240) - firstPaused}, (_, i) => comparisonState(firstPaused + i, player)).every(state => state.paused && !state.play)));
  check('Player 1 metric switches at exact narration-aligned frame 174', comparisonState(173, 1).metric === 'supportKnee' && comparisonState(174, 1).metric === 'thighTilt' && firstPaused === 81);

  const spec = await read('audio-source/weak-foot-v1.json');
  const captions = await read('public/audio-weak-foot-v1/captions.json');
  const passages = spec.passages ?? spec.segments;
  const lines = captions.captions ?? captions;
  const narrationText = passages.map(passage => passage.text).join(' ');
  check('Backswing narration starts when frozen feedback is fully visible', Math.abs(passages[2].utterances[0].start - (13 + firstPaused / 30)) < 1e-6, passages[2].utterances[0].start);
  check('Narration and captions match word for word', words(lines.map(caption => caption.text).join(' ')) === words(narrationText), {narrationWords: words(narrationText).split(' ').length, captionWords: words(lines.map(caption => caption.text).join(' ')).split(' ').length});
  check('Caption intervals are ordered and contained in 60 seconds', lines.every((caption, i) => finite(caption.start) && finite(caption.end) && caption.start >= 0 && caption.end > caption.start && caption.end <= 60 && (!i || caption.start >= lines[i - 1].end - .001)));
  check('No athlete names in narration or captions', !/\b(?:guy|maurizio|marizio)\b/i.test(narrationText));
  const srt = await fs.readFile(path.join(root, 'public/audio-weak-foot-v1/captions.srt'), 'utf8');
  const srtCues = srt.trim().replace(/\r\n/g, '\n').split(/\n\s*\n/).map(block => block.split('\n').slice(2).join(' '));
  check('Delivered SRT preserves exact narration and cue order', srtCues.length === lines.length && srtCues.every((text, i) => words(text) === words(lines[i].text)) && words(srtCues.join(' ')) === words(narrationText));
  const audio = await read('public/audio-weak-foot-v1/audio-manifest.json');
  const mixed = audio.audio['master.wav'];
  check('Audio manifest completed with exact 60-second clock', audio.passed && audio.duration_seconds === 60 && audio.duration_frames === 1800 && audio.fps === 30 && mixed.samples === 2_880_000);
  check('Narration/caption receipt matches exact text', audio.narration.exact_approved_passages === passages.length && audio.narration.word_count_whitespace === words(narrationText).split(' ').length && audio.captions.exact_approved_words_and_punctuation === true);
  check('Continuous music and speech ducking configured', spec.music.continuous === true && spec.music.duck_db === 16);
  check('Master audio checksum and levels', digest(await fs.readFile(path.join(root, 'public/audio-weak-foot-v1/master.wav'))) === mixed.sha256 && Math.abs(mixed.integrated_lufs + 16) < .5 && mixed.true_peak_dbtp <= -1, {integratedLUFS: mixed.integrated_lufs, truePeakDBTP: mixed.true_peak_dbtp});

  const mediaArgs = process.argv.slice(2).filter(arg => arg.startsWith('--media=')).map(arg => path.resolve(root, arg.slice(8)));
  for (const media of mediaArgs) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', media], {encoding: 'utf8'}));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    const name = path.basename(media);
    check(`${name}: portrait composition and exact encoded duration`, video && video.width * 16 === video.height * 9 && Number(video.nb_read_frames) === 1800 && video.avg_frame_rate === '30/1' && Math.abs(Number(probe.format.duration) - 60) <= .05, {width: video?.width, height: video?.height, frames: video?.nb_read_frames, fps: video?.avg_frame_rate, duration: probe.format.duration});
    execFileSync('ffmpeg', ['-v', 'error', '-i', media, '-f', 'null', '-'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    check(`${name}: full decode`, true);
  }
} catch (error) {
  check('Verification completed without missing or unreadable inputs', false, String(error.message ?? error));
}

const report = {createdAt: new Date().toISOString(), passed: checks.every(item => item.passed), checks};
await fs.mkdir(output, {recursive: true});
await fs.writeFile(path.join(output, 'source-validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({passed: report.passed, checks: checks.length, failed: checks.filter(item => !item.passed)}, null, 2));
if (!report.passed) process.exitCode = 1;

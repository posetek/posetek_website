/* Prepare the four approved weak-foot film recordings using read-only cloud access.
 * Remote records are never created, reviewed, modified, or analyzed by an AI job.
 * Identity-bearing source material and receipts remain in ignored local folders.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const video = path.resolve(__dirname, '..');
const sourceRoot = process.env.POSETEK_SOURCE_ROOT || path.resolve(video, '../..');
const dependenciesRoot = fs.existsSync(path.join(sourceRoot, 'functions/node_modules/@google-cloud/firestore'))
  ? sourceRoot : path.resolve(sourceRoot, '../..');
const publicDir = path.join(video, 'public/weak-foot-v1');
const receiptDir = path.join(video, 'output/weak-foot-v1');
const cacheDir = path.join(receiptDir, 'private-source');
const selectionFile = process.env.POSETEK_WEAK_FOOT_SELECTION || path.join(video, 'public/product/pose-source/selection.json');
const project = 'kickai-69dd0';
const bucketName = 'kickai-69dd0.firebasestorage.app';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => crypto.createHash('md5').update(bytes).digest('base64');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'}));
const metricModule = path.join(sourceRoot, 'services/agent-gateway/gateway/kick_metrics.py');

// Only identities come from the private prior selection. Select the first session/rep,
// never the most dramatic disparity or a different athlete's opposite-foot recording.
const prior = read(selectionFile);
const sourcePlayers = [prior.find(row => row.key === 'guy-jump'), prior.find(row => row.key === 'maurizio-jump')];
assert(sourcePlayers.every(row => typeof row?.uid === 'string'), 'Private player selection unavailable');
const expected = [
  {key: 'player1-right', player: 0, foot: 'right', session: 1, backswing: 417, contact: 443, supportKnee: 143.21318958022218, thighTilt: 51.54868520859588},
  {key: 'player1-left', player: 0, foot: 'left', session: 2, backswing: 458, contact: 472, supportKnee: 111.09476209746953, thighTilt: 10.813408339874904},
  {key: 'player2-right', player: 1, foot: 'right', session: 1, backswing: 532, contact: 542, supportKnee: 139.81727501056096, thighTilt: 21.952156040104875},
  {key: 'player2-left', player: 1, foot: 'left', session: 2, backswing: 452, contact: 464, supportKnee: 123.10438558935132, thighTilt: 1.9487490996259242},
];

const metricProgram = String.raw`import importlib.util,json,sys,math
spec=importlib.util.spec_from_file_location('kick_metrics',sys.argv[1]);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
d=json.load(sys.stdin)
r=mod.compute_kick_analysis(d['pose'],{},None,d['metadata'],[],{},None,contact_frame=d['contact'],transition_frame=d['backswing'],fps=d['fps'],strike_foot=d['foot'],direction=d['direction'])
ids={'supportKnee':'backswing.knee_angle.support','thighTilt':'backswing.thigh_angle.kicking'}
rows={key:next(row for row in r['metrics'] if row['id']==value) for key,value in ids.items()}
for row in rows.values():
 assert row['valid'] and row['athleteFrame']==d['backswing'] and math.isfinite(row['athlete'])
assert r['orientation']['sideAgreement']=='agree'
selected=sorted(set(joint for row in rows.values() for joint in row['jointIds']))
confidence={str(joint):d['pose'][d['backswing']][joint][3] for joint in selected}
assert all(value>=.1 for value in confidence.values())
print(json.dumps({'metrics':{key:row['athlete'] for key,row in rows.items()},'metricRows':rows,'orientation':r['orientation'],'keyFrames':r['keyFrames'],'landmarkConfidence':confidence,'dataQuality':{'keyFramesValid':r['dataQuality']['keyFramesValid'],'sideConfidence':r['dataQuality']['sideConfidence'],'poseCoverage':r['dataQuality']['poseCoverage'],'followThroughClamped':r['dataQuality']['followThroughClamped']}}))`;

async function main() {
  for (const dir of [publicDir, receiptDir, cacheDir]) fs.mkdirSync(dir, {recursive: true});
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'));
  const account = auth.getGlobalDefaultAccount();
  assert(account?.tokens?.refresh_token, 'Existing authorized Firebase CLI account unavailable');
  const cred = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  const headers = {Authorization: `Bearer ${cred.access_token}`};
  const request = async url => {
    const response = await fetch(url, {headers, signal: AbortSignal.timeout(90000)});
    if (!response.ok) throw new Error(`Read-only asset request failed HTTP ${response.status}`);
    return response;
  };
  const moduleAt = name => require(path.join(dependenciesRoot, 'functions/node_modules', name));
  const {Firestore} = moduleAt('@google-cloud/firestore');
  const {Storage} = moduleAt('@google-cloud/storage');
  const {GoogleAuth, OAuth2Client} = moduleAt('google-auth-library');
  const client = new OAuth2Client();
  client.setCredentials({access_token: cred.access_token, expiry_date: Date.now() + 45 * 60000});
  const googleAuth = new GoogleAuth({projectId: project, authClient: client});
  const db = new Firestore({projectId: project, auth: googleAuth});
  const bucket = new Storage({projectId: project, authClient: googleAuth}).bucket(bucketName);
  class HttpsError extends Error {constructor(code, message) {super(message); this.code = code;}}
  const service = require(path.join(sourceRoot, 'functions/effective-results.js')).createEffectiveResults({db, bucket, HttpsError});
  try {
    const inventories = await Promise.all(sourcePlayers.map(row => service.listForPlayer(row.uid, 'shooting', true)));
    const records = [], receiptRecords = [], privateIds = sourcePlayers.map(row => row.uid);
    for (const spec of expected) {
      const uid = sourcePlayers[spec.player].uid;
      const candidates = inventories[spec.player].reps.filter(rep => rep.sessionNumber === spec.session && rep.repNumber === 1 && rep.strike_foot === spec.foot && rep.resultStatus.qualified && !rep.resultStatus.duplicate);
      assert.equal(candidates.length, 1, `${spec.key}: expected one qualified first rep`);
      const rep = candidates[0];
      assert.equal(rep.contact_frame, spec.contact); assert.equal(rep.transition_frame, spec.backswing);
      assert(rep.storageFolder, 'Exact qualified storage folder unavailable');
      privateIds.push(rep.id, rep.sessionId, rep.storageFolder);
      const local = path.join(cacheDir, spec.key); fs.mkdirSync(local, {recursive: true});
      const files = [];
      async function sourceFile(name) {
        const object = `${rep.storageFolder}/${name}`;
        const meta = await (await request(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(object)}`)).json();
        const file = path.join(local, name);
        let bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
        if (!(bytes && bytes.length === Number(meta.size) && md5(bytes) === meta.md5Hash)) {
          const oldKey = spec.player === 0 ? `guy-${spec.foot}` : null;
          const oldFile = oldKey && path.join(video, 'public/product/pose-source', oldKey, name);
          const oldBytes = oldFile && fs.existsSync(oldFile) ? fs.readFileSync(oldFile) : null;
          bytes = oldBytes && oldBytes.length === Number(meta.size) && md5(oldBytes) === meta.md5Hash ? oldBytes
            : Buffer.from(await (await request(`https://storage.googleapis.com/download/storage/v1/b/${bucketName}/o/${encodeURIComponent(object)}?alt=media&generation=${meta.generation}`)).arrayBuffer());
          assert.equal(bytes.length, Number(meta.size)); assert.equal(md5(bytes), meta.md5Hash, 'Original object checksum mismatch');
          fs.writeFileSync(file, bytes);
        }
        files.push({name, object, generation: meta.generation, bytes: bytes.length, md5Hash: meta.md5Hash, sha256: sha(bytes)});
        return {file, bytes};
      }
      const poseFile = await sourceFile('pose.json');
      const metadata = JSON.parse((await sourceFile('metadata.json')).bytes.toString('utf8'));
      const context = JSON.parse((await sourceFile('reprocess_context.json')).bytes.toString('utf8'));
      assert.equal(context.rep.playerDocId, uid); assert.equal(context.rep.repId, rep.id);
      assert.equal(metadata.processingStatus, 'complete'); assert.equal(metadata.resultsValid, true);
      assert.equal(context.capture.recordingMatchesCalibrationGeometry, true);
      const fps = Number(metadata.framesPerSecond ?? metadata.fps ?? context.capture.clipFramesPerSecondUsed);
      assert.equal(fps, 240, 'Previously verified capture timing changed');
      const width = metadata.frameWidth, height = metadata.frameHeight;
      assert.equal(width, 1280); assert.equal(height, 720);
      const poseRaw = JSON.parse(poseFile.bytes.toString('utf8'));
      const rawFrames = Array.isArray(poseRaw) ? poseRaw : poseRaw.frames;
      assert(rawFrames.length > spec.contact + 50, 'Incomplete kick/recovery pose');
      const frames = rawFrames.map(frame => {
        const points = Array.isArray(frame) ? frame : frame?.landmarks ?? frame?.pose ?? Array(33).fill(null);
        assert.equal(points.length, 33, 'Expected full MediaPipe33 layout');
        return points.map(point => {
          if (!point) return [null, null, null, 0];
          const values = Array.isArray(point) ? point : [point.x, point.y, point.z ?? 0, point.visibility ?? point.confidence ?? 1];
          return [Number.isFinite(values[0]) ? values[0] : null, Number.isFinite(values[1]) ? values[1] : null, Number.isFinite(values[2]) ? values[2] : null, Number.isFinite(values[3]) ? values[3] : 0];
        });
      });
      const metrics = JSON.parse(execFileSync(process.env.POSETEK_PYTHON || 'python', ['-B', '-c', metricProgram, metricModule], {
        input: JSON.stringify({pose: frames, metadata, foot: spec.foot, fps, contact: spec.contact, backswing: spec.backswing, direction: rep.direction}), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      }));
      for (const key of ['supportKnee', 'thighTilt']) assert(Math.abs(metrics.metrics[key] - spec[key]) < 1e-9, `${spec.key}: ${key} changed`);
      const movieName = context.rep.videoFileName || 'side_kick_240.mov';
      const movie = await sourceFile(movieName); const originalProbe = probe(movie.file);
      const originalVideo = originalProbe.streams.find(stream => stream.codec_type === 'video');
      assert.equal(originalVideo.width, width); assert.equal(originalVideo.height, height);
      assert.equal(Number(originalVideo.nb_frames), frames.length, 'Movie/pose frame count mismatch');
      const rotation = originalVideo.side_data_list?.find(row => row.rotation !== undefined)?.rotation ?? 0;
      assert.equal(rotation, 0, 'Review orientation before preparing proxy');
      const proxyFile = path.join(publicDir, `${spec.key}.mp4`);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', movie.file, '-map', '0:v:0', '-vf', 'fps=30', '-an', '-sn', '-dn', '-map_metadata', '-1', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', proxyFile], {stdio: ['ignore', 'pipe', 'pipe']});
      const proxyProbe = probe(proxyFile), proxyVideo = proxyProbe.streams.find(stream => stream.codec_type === 'video');
      assert.equal(proxyProbe.streams.length, 1, 'Proxy must contain no audio or metadata track');
      assert.equal(proxyVideo.width, width); assert.equal(proxyVideo.height, height); assert.equal(proxyVideo.avg_frame_rate, '30/1');
      const originalDuration = Number(originalProbe.format.duration), durationSeconds = Number(proxyProbe.format.duration);
      assert(Math.abs(durationSeconds - originalDuration) <= 1 / 30 + .001, 'Proxy changed source duration');
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', proxyFile, '-f', 'null', '-'], {stdio: ['ignore', 'pipe', 'pipe']});
      records.push({key: spec.key, foot: spec.foot, fps, width, height, frames, contactFrame: spec.contact, backswingFrame: spec.backswing, followThroughFrame: metrics.keyFrames.followThrough, direction: rep.direction, metrics: metrics.metrics, video: {src: `weak-foot-v1/${spec.key}.mp4`, durationSeconds}});
      receiptRecords.push({key: spec.key, uid, repId: rep.id, sessionNumber: spec.session, repNumber: 1, canonical: rep, source: files, captureFPS: fps, frameCount: frames.length, originalProbe, metrics, activePoseRange: [spec.contact - 120, spec.contact + 168], proxy: {path: proxyFile, bytes: fs.statSync(proxyFile).size, sha256: sha(fs.readFileSync(proxyFile)), probe: proxyProbe}, timingPolicy: 'Original movie timestamps preserved at 30 fps; saved pose frame timing uses source-declared 240 fps. No retiming, cropping, or synthetic joints.'});
      console.log(`${spec.key}: ${frames.length} recorded poses; native ${originalDuration.toFixed(3)}s -> 30fps ${durationSeconds.toFixed(3)}s; verified source knee ${metrics.metrics.supportKnee.toFixed(1)} degrees`);
    }
    const payload = JSON.stringify({version: 1, records}) + '\n';
    for (const id of privateIds) if (id) assert(!payload.includes(id), 'Identity leaked into render payload');
    assert(!/\b(Guy|Maurizio|Dylan)\b/i.test(payload), 'Personal name leaked into render payload');
    fs.writeFileSync(path.join(publicDir, 'poses.json'), payload);
    write(path.join(receiptDir, 'assets-manifest.json'), {version: 1, preparedAt: new Date().toISOString(), remoteMutations: 0, selectionPolicy: 'First qualified right-foot Session 1 Rep 1, then first qualified left-foot Session 2 Rep 1 for each approved player.', preferredFootEvidence: ['Recorded profile: Right', 'User explicitly confirmed: Right'], renderPayloadSha256: sha(payload), metricModuleSha256: sha(fs.readFileSync(metricModule)), confidenceThreshold: .1, records: receiptRecords});
    console.log('Prepared four anonymous recordings in two same-player pairs; private provenance retained; zero remote mutations.');
  } finally {
    await db.terminate();
  }
}

main().catch(error => {console.error(error.message); process.exitCode = 1;});

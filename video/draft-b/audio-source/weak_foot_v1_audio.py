"""Build only the approved weaker-foot film's audio, captions and verification.

Run with audio-source/.venv/Scripts/python.exe audio-source/weak_foot_v1_audio.py.
Uses the already installed af_heart voice and the existing original score engine.
"""
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import textwrap
import numpy as np
import soundfile as sf
from exact_score import render_score
from exact_v3_mix import ducked_score, meter, blocks

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio-source'
SPEC_PATH = AUDIO / 'weak-foot-v1.json'
SPEC = json.loads(SPEC_PATH.read_text(encoding='utf-8'))
WORK = AUDIO / 'work/weak-foot-v1'
OUT = ROOT / 'public/audio-weak-foot-v1'
DELIVERY = ROOT / 'output/weak-foot-v1'
SR = SPEC['sample_rate']
N = SPEC['duration_seconds'] * SR


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tokens(text):
    text = text.lower().replace('’', "'")
    text = text.replace('posetek', 'pose tech').replace('posetech', 'pose tech')
    # ASR cannot distinguish the homophonic possessive from its plural spelling.
    text = text.replace("player's", 'players')
    # Whisper sometimes contracts reassessment into a compound or splits it.
    text = text.replace('re assessment', 'reassessment').replace('re-assessment', 'reassessment')
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text)


def run_ffmpeg(args):
    result = subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-y', *map(str, args)],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stderr


def normalize(source, dest, target):
    log = run_ffmpeg(['-i', source, '-af', f'loudnorm=I={target}:TP=-1.6:LRA=7:print_format=json', '-f', 'null', '-'])
    level = json.loads(re.findall(r'\{[\s\S]*?\}', log)[-1])
    filt = f"loudnorm=I={target}:TP=-1.6:LRA=7:measured_I={level['input_i']}:measured_TP={level['input_tp']}:measured_LRA={level['input_lra']}:measured_thresh={level['input_thresh']}:offset={level['target_offset']}:linear=true"
    run_ffmpeg(['-i', source, '-af', filt, '-ar', SR, '-c:a', 'pcm_s24le', dest])


def stamp(t):
    ms = round(t * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'


def main():
    for path in [WORK, OUT, DELIVERY, WORK / 'tmp']:
        path.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(WORK / 'tmp')
    utterances = []
    for passage in SPEC['passages']:
        assert ' '.join(u['text'] for u in passage['utterances']) == passage['text']
        for utterance in passage['utterances']:
            assert ' '.join(utterance['caption_phrases']) == utterance['text']
            assert passage['start'] <= utterance['start'] < utterance['end'] <= passage['end']
            utterances.append({**utterance, 'passage': passage['id']})
    script = ' '.join(p['text'] for p in SPEC['passages'])
    assert len(SPEC['passages']) == 7 and N == 2880000
    from kokoro_onnx import Kokoro
    tts = Kokoro(str(AUDIO / 'models/kokoro-v1.0.onnx'), str(AUDIO / 'models/voices-v1.0.bin'))
    measurements = []
    for u in utterances:
        spoken = u['text']
        for original, pronunciation in SPEC['pronunciation_only_substitutions'].items():
            spoken = spoken.replace(original, pronunciation)
        path = WORK / f"{u['id']}.wav"
        cache = WORK / f"{u['id']}-tts.json"
        key = hashlib.sha256(json.dumps([spoken, SPEC['voice'], SPEC['language'], SPEC['synthesis_rate']]).encode()).hexdigest()
        if not (path.exists() and cache.exists() and json.loads(cache.read_text(encoding='utf-8'))['key'] == key):
            samples, sr = tts.create(spoken, voice=SPEC['voice'], lang=SPEC['language'], speed=SPEC['synthesis_rate'])
            active = np.where(np.abs(samples) > .0015)[0]
            samples = samples[max(0, active[0] - round(.035 * sr)):min(len(samples), active[-1] + round(.12 * sr))]
            fade = min(round(.008 * sr), len(samples) // 2)
            samples[:fade] *= np.linspace(0, 1, fade)
            samples[-fade:] *= np.linspace(1, 0, fade)
            sf.write(path, samples, sr, subtype='PCM_24')
            dump(cache, {'key': key})
        samples, sr = sf.read(path)
        duration = len(samples) / sr
        assert u['start'] + duration <= u['end'], f"Speech overrun {u['id']} ({duration}s)"
        m = {'id': u['id'], 'passage': u['passage'], 'start': u['start'], 'end': round(u['start']+duration, 6),
             'speech_seconds': duration, 'text': u['text'], 'text_sha256': hashlib.sha256(u['text'].encode()).hexdigest(),
             'audio_sha256': digest(path), 'natural_synthesis_rate': SPEC['synthesis_rate'], 'post_synthesis_rate': 1}
        measurements.append(m)
        print(json.dumps(m, ensure_ascii=True), flush=True)
    dump(OUT / 'measurements.json', measurements)
    from faster_whisper import WhisperModel
    models = list((AUDIO / 'models/models--Systran--faster-whisper-base.en/snapshots').glob('*/model.bin'))
    assert models, 'The installed local ASR model is required; no download is attempted.'
    model = WhisperModel(str(models[0].parent), device='cpu', compute_type='int8', cpu_threads=4)
    caps, speech_report = [], []
    for u, measurement in zip(utterances, measurements):
        wav = WORK / f"{u['id']}.wav"
        cache = WORK / f"{u['id']}-asr.json"
        if cache.exists() and json.loads(cache.read_text(encoding='utf-8'))['sha256'] == digest(wav) and json.loads(cache.read_text(encoding='utf-8')).get('decoder_version') == 2:
            rows = json.loads(cache.read_text(encoding='utf-8'))['rows']
        else:
            segments, _ = model.transcribe(str(wav), language='en', beam_size=5, vad_filter=True,
                                          vad_parameters={'min_silence_duration_ms': 100, 'speech_pad_ms': 40},
                                          word_timestamps=True, condition_on_previous_text=False, temperature=0,
                                          hallucination_silence_threshold=.1)
            rows = [{'start': s.start, 'end': s.end, 'text': s.text.strip(),
                     'words': [{'start': w.start, 'end': w.end, 'word': w.word.strip()} for w in s.words]} for s in segments]
            dump(cache, {'sha256': digest(wav), 'decoder_version': 2, 'rows': rows})
        recognized = [{**word, 'token': token} for row in rows for word in row['words'] for token in tokens(word['word'])]
        expected = tokens(u['text'])
        matcher = difflib.SequenceMatcher(None, expected, [word['token'] for word in recognized], autojunk=False)
        mapping, differences = {}, []
        for tag, a, b, c, d in matcher.get_opcodes():
            if tag == 'equal':
                mapping.update({a+i: recognized[c+i] for i in range(b-a)})
            else:
                differences.append({'expected': ' '.join(expected[a:b]), 'recognized': ' '.join(w['token'] for w in recognized[c:d])})
        assert matcher.ratio() >= .88, f"ASR review required for {u['id']}: {differences}"
        offset, local_caps = 0, []
        for text in u['caption_phrases']:
            count = len(tokens(text))
            matched = [mapping[i] for i in range(offset, offset+count) if i in mapping]
            assert matched, text
            local_caps.append({'start': round(u['start']+max(0,matched[0]['start']),3),
                               'end': round(u['start']+min(measurement['speech_seconds'],matched[-1]['end']+.08),3), 'text': text})
            offset += count
        for a, b in zip(local_caps, local_caps[1:]):
            if a['end'] > b['start']:
                a['end'] = b['start'] = round((a['end']+b['start'])/2,3)
        caps.extend(local_caps)
        speech_report.append({'id': u['id'], 'recognition_agreement': matcher.ratio(), 'differences': differences,
                              'recognized_text': ' '.join(row['text'] for row in rows), 'audio_sha256': digest(wav)})
        print(json.dumps(speech_report[-1], ensure_ascii=True), flush=True)
    assert ' '.join(c['text'] for c in caps) == script
    assert all(c['start'] < c['end'] <= 57 for c in caps)
    assert all(a['end'] <= b['start'] for a,b in zip(caps,caps[1:]))
    assert all(len(textwrap.wrap(c['text'],width=32,break_long_words=False,break_on_hyphens=False)) <= 2 for c in caps)
    dump(OUT / 'captions.json', caps)
    dump(OUT / 'aligned.json', caps)
    (OUT / 'captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n"+'\n'.join(textwrap.wrap(c['text'],width=32,break_long_words=False,break_on_hyphens=False)) for i,c in enumerate(caps))+'\n',encoding='utf-8')
    dump(OUT / 'speech-check.json', {'voice': SPEC['voice'], 'natural_synthesis_rate': SPEC['synthesis_rate'],
        'independent_model': 'Whisper base.en, no prompt', 'passages': speech_report, 'listening_review': False})
    narration = np.zeros(N)
    for u in utterances:
        dest = WORK / f"{u['id']}-48k.wav"
        run_ffmpeg(['-i', WORK/f"{u['id']}.wav", '-af', 'highpass=f=75,lowpass=f=10500,acompressor=threshold=0.16:ratio=2:attack=15:release=120:makeup=1', '-ar', SR, '-c:a', 'pcm_s24le', dest])
        samples, sr = sf.read(dest)
        active = samples[np.abs(samples) > .01]
        samples *= .13 / max(np.sqrt(np.mean(active**2)), .0001)
        start = round(u['start'] * SR)
        narration[start:start+len(samples)] += samples
    sf.write(WORK/'narration-raw.wav', narration, SR, subtype='PCM_24')
    normalize(WORK/'narration-raw.wav', OUT/'narration.wav', -17)
    narration, sr = sf.read(OUT/'narration.wav', always_2d=True)
    assert sr == SR and len(narration) == N
    assert not narration[57*SR:].any()
    score = render_score(SPEC['duration_seconds'], SR, SPEC['bpm'], SPEC['transitions'])
    sf.write(WORK/'bed-raw.wav', score, SR, subtype='PCM_24')
    normalize(WORK/'bed-raw.wav', WORK/'bed-leveled.wav', -28)
    score, _ = sf.read(WORK/'bed-leveled.wav', always_2d=True)
    voice = np.repeat(narration, 2, axis=1)
    bed, gain, active = ducked_score(score, voice)
    vp, bp = blocks(voice, 4800), blocks(bed, 4800)
    voiced = vp > 10**(-30/10)
    separation_before = float(10*np.log10(vp[voiced].sum()/bp[voiced].sum()))
    music_calibration_db = separation_before - SPEC['music']['duck_db']
    bed *= 10**(music_calibration_db/20)
    sf.write(OUT/'bed.wav', bed, SR, subtype='PCM_24')
    bed, _ = sf.read(OUT/'bed.wav', always_2d=True)
    raw = voice + bed
    sf.write(WORK/'mix-raw.wav', raw, SR, subtype='FLOAT')
    raw_level = meter(WORK/'mix-raw.wav')
    master_gain_db = -16-raw_level['integrated_lufs']
    master_gain = 10**(master_gain_db/20)
    sf.write(WORK/'mix-gained.wav', raw*master_gain, SR, subtype='FLOAT')
    # A brief lookahead only catches peaks exceeding the encoding headroom.
    # latency=1 compensates that lookahead; no narration timing is changed.
    run_ffmpeg(['-i', WORK/'mix-gained.wav', '-af', 'alimiter=limit=0.8317637711:attack=5:release=50:level=0:latency=1',
                '-ar', SR, '-c:a', 'pcm_s24le', OUT/'master.wav'])
    measured = {}
    for name in ['narration.wav', 'bed.wav', 'master.wav']:
        data, sr = sf.read(OUT/name, always_2d=True)
        assert len(data) == N and sr == SR and np.isfinite(data).all() and np.max(np.abs(data)) < 1
        measured[name] = {**meter(OUT/name), 'samples': N, 'duration_seconds': N/SR, 'channels': data.shape[1], 'sha256': digest(OUT/name)}
    assert -16.5 <= measured['master.wav']['integrated_lufs'] <= -15.5, measured['master.wav']
    assert measured['master.wav']['true_peak_dbtp'] <= -1.5
    separation = float(10*np.log10(vp[voiced].sum()/blocks(bed,4800)[voiced].sum()))
    assert abs(separation-16) < .02
    minimum_music = float(np.sqrt(blocks(bed[SR:-SR],4800)).min())
    assert minimum_music > 1e-6
    report = {'version': SPEC['version'], 'passed': True, 'duration_seconds': 60, 'duration_frames': 1800, 'fps': 30,
        'sample_rate': SR, 'samples': N, 'spec_sha256': digest(SPEC_PATH), 'voice': SPEC['voice'],
        'natural_synthesis_rate': SPEC['synthesis_rate'], 'post_synthesis_speed_change': False,
        'score': 'Existing original 106 BPM oscillator/noise engine; no third-party samples.',
        'mux_instruction': 'Use master.wav as the sole soundtrack. All field recordings must remain muted.',
        'narration': {'exact_approved_passages': 7, 'word_count_whitespace': len(script.split()),
            'script_sha256': hashlib.sha256(script.encode()).hexdigest(), 'all_passages_fit': True, 'music_only_after_seconds': 57,
            'first_left_narration_start': 8.7, 'second_left_narration_start': 26.7},
        'captions': {'exact_approved_words_and_punctuation': True, 'cues': len(caps), 'max_lines': 2,
            'wrap_characters': 32, 'sha256': digest(OUT/'captions.json')},
        'ducking': {'target_music_below_speech_db': 16, 'measured_voiced_energy_separation_db': separation,
            'attack_seconds': .15, 'release_seconds': .35, 'lookahead_seconds': .15,
            'music_calibration_db': music_calibration_db, 'minimum_music_100ms_rms_excluding_edges': minimum_music},
        'mix': {'master_gain_db': master_gain_db, 'master_gain_linear': master_gain, 'raw_levels': raw_level,
            'method': 'Linear sum of placed narration and continuously ducked score; constant master gain and latency-compensated 5 ms safety limiter.',
            'limiter': {'ceiling_dbfs': -1.6, 'attack_ms': 5, 'release_ms': 50, 'latency_compensated': True}},
        'audio': measured}
    dump(OUT/'audio-manifest.json', report)
    dump(OUT/'validation.json', report)
    dump(OUT/'segments.json', measurements)
    dump(OUT/'timeline.json', SPEC)
    dump(DELIVERY/'audio-validation.json', report)
    shutil.copyfile(OUT/'captions.srt', DELIVERY/'PoseTek-Weak-Foot-Investor-V1.srt')
    print(json.dumps(report, indent=2, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()

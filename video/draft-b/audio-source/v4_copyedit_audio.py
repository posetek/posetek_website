"""Grammar-only V4 narration revision, with an extended spoken closing card.

Previous edition audio and assets are read-only. The original demonstration's
complete mixed PCM is preserved, including music, countdown and timing.
"""
from pathlib import Path
import difflib
import hashlib
import json
import re
import shutil
import tempfile
import textwrap
import numpy as np
import soundfile as sf
from weak_foot_v1_audio import run_ffmpeg, normalize, stamp
from exact_v3_mix import ducked_score, meter, blocks, dump, digest

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio-source'
SPEC_PATH = AUDIO / 'investor-v4-copyedit.json'
SPEC = json.loads(SPEC_PATH.read_text(encoding='utf-8'))
WORK = AUDIO / 'work/investor-v4-copyedit'
OUT = ROOT / 'public/audio-investor-v4-copyedit'
DELIVERY = ROOT / 'output/investor-v4-copyedit'
SR = SPEC['sample_rate']
N = SPEC['duration_seconds'] * SR


def tokens(text):
    text = text.lower().replace('’', "'")
    text = text.replace('posetek.net', 'pose tech dot net')
    text = text.replace('posetek', 'pose tech').replace('posetech', 'pose tech')
    text = text.replace('d1', 'd one').replace('d 1', 'd one')
    text = text.replace('reevaluation', 're evaluation').replace('re-evaluation', 're evaluation')
    text = text.replace('.net', ' dot net')
    return re.findall(r'[a-z0-9]+', text)


def wrap_caption(text):
    # Author line breaks at clause boundaries rather than splitting noun phrases.
    if len(text) <= 70:
        return text
    layouts = [
        'to bring elite-level performance testing\nto every competitive soccer player',
        'Using just the smartphone, our custom-made cones,\nand our proprietary technology,',
        "we are able to capture athletes' movements\nacross a broad set of movements.",
        "Our technology captures athletes' movements\nwith computer vision directly on the smartphone,",
        'while considering their position\nand where they sit on the developmental pathway.',
        'and provides the tips and cues\nthat close the loop on performance improvement.',
        'Periodic retesting and re-evaluation\nallow the athlete to grow with the platform.',
    ]
    selected = next(layout for layout in layouts if layout.replace('\n',' ')==text)
    assert max(map(len,selected.splitlines()))<=70
    return selected


def main():
    for path in [WORK, OUT, DELIVERY, WORK/'tmp']:
        path.mkdir(parents=True,exist_ok=True)
    tempfile.tempdir = str(WORK/'tmp')
    script = ' '.join(p['text'] for p in SPEC['passages'])
    assert len(SPEC['passages']) == 10 and N == 5568000
    preserved = {str(p.relative_to(ROOT)):digest(p) for p in [
        ROOT/'public/audio-investor-exact-v4/master.wav',
        ROOT/'public/audio-investor-exact-v4/captions.json',
        ROOT/'output/investor-exact-v4/PoseTek-Investor-Exact-V4-1080p.mp4',
        ROOT/'output/investor-exact-v4/PoseTek-Investor-Exact-V4-Timed-Proof.mp4']}
    from kokoro_onnx import Kokoro
    tts = Kokoro(str(AUDIO/'models/kokoro-v1.0.onnx'),str(AUDIO/'models/voices-v1.0.bin'))
    measurements = []
    for p in SPEC['passages']:
        assert ' '.join(p['caption_phrases']) == p['text']
        spoken = p['text']
        for original, pronunciation in SPEC['pronunciation_only_substitutions'].items():
            spoken = spoken.replace(original,pronunciation)
        path,cache = WORK/f"{p['id']}.wav",WORK/f"{p['id']}-tts.json"
        key = hashlib.sha256(json.dumps([spoken,SPEC['voice'],SPEC['language'],SPEC['synthesis_rate']]).encode()).hexdigest()
        if p['id'] in ['passage_01','passage_05']:
            original = json.loads((AUDIO/'investor-exact-v2.json').read_text(encoding='utf-8'))
            old_p = next(item for item in original['passages'] if item['id']==p['id'])
            assert tokens(old_p['text'])==tokens(p['text'])
            shutil.copyfile(AUDIO/'work/investor-exact-v2'/f"{p['id']}.wav",path)
            dump(cache,{'key':key,'unchanged_spoken_passage_reused':True})
        if not (path.exists() and cache.exists() and json.loads(cache.read_text(encoding='utf-8'))['key']==key):
            samples,sr = tts.create(spoken,voice=SPEC['voice'],lang=SPEC['language'],speed=SPEC['synthesis_rate'])
            active = np.where(np.abs(samples)>.0015)[0]
            samples = samples[max(0,active[0]-round(.035*sr)):min(len(samples),active[-1]+round(.12*sr))]
            fade = min(round(.008*sr),len(samples)//2)
            samples[:fade] *= np.linspace(0,1,fade)
            samples[-fade:] *= np.linspace(1,0,fade)
            sf.write(path,samples,sr,subtype='PCM_24')
            dump(cache,{'key':key})
        samples,sr = sf.read(path)
        duration = len(samples)/sr
        assert p['start']+duration <= p['end'],f"Speech overrun {p['id']}: {duration}s in {p['end']-p['start']}s"
        m = {'id':p['id'],'start':p['start'],'end':round(p['start']+duration,6),
             'speech_seconds':duration,'text':p['text'],'audio_sha256':digest(path),
             'natural_synthesis_rate':SPEC['synthesis_rate'],'post_synthesis_rate':1}
        measurements.append(m)
        print(json.dumps(m,ensure_ascii=True),flush=True)
    dump(OUT/'segments.json',measurements)
    from faster_whisper import WhisperModel
    models = list((AUDIO/'models/models--Systran--faster-whisper-base.en/snapshots').glob('*/model.bin'))
    assert models
    model = WhisperModel(str(models[0].parent),device='cpu',compute_type='int8',cpu_threads=4)
    caps,reports = [],[]
    for p,m in zip(SPEC['passages'],measurements):
        wav,cache = WORK/f"{p['id']}.wav",WORK/f"{p['id']}-asr.json"
        if cache.exists() and json.loads(cache.read_text(encoding='utf-8'))['sha256']==digest(wav):
            rows=json.loads(cache.read_text(encoding='utf-8'))['rows']
        else:
            segments,_=model.transcribe(str(wav),language='en',beam_size=5,vad_filter=True,
                vad_parameters={'min_silence_duration_ms':100,'speech_pad_ms':40},
                word_timestamps=True,condition_on_previous_text=False,temperature=0,
                hallucination_silence_threshold=.1)
            rows=[{'start':s.start,'end':s.end,'text':s.text.strip(),
                'words':[{'start':w.start,'end':w.end,'word':w.word.strip()} for w in s.words]} for s in segments]
            dump(cache,{'sha256':digest(wav),'rows':rows})
        recognized=[{**w,'token':t} for row in rows for w in row['words'] for t in tokens(w['word'])]
        expected=tokens(p['text'])
        matcher=difflib.SequenceMatcher(None,expected,[w['token'] for w in recognized],autojunk=False)
        mapping,differences={},[]
        for tag,a,b,c,d in matcher.get_opcodes():
            if tag=='equal':mapping.update({a+i:recognized[c+i] for i in range(b-a)})
            else:differences.append({'expected':' '.join(expected[a:b]),'recognized':' '.join(w['token'] for w in recognized[c:d])})
        # Keep recognizer errors visible in the report; the brand is checked
        # against the exact TTS input as well as an independent recognition pass.
        brand_alias = p['id']=='closing_cta' and differences==[
            {'expected':'pose','recognized':'post'}, {'expected':'pose','recognized':'post'}]
        spoken = p['text']
        for original, pronunciation in SPEC['pronunciation_only_substitutions'].items():
            spoken=spoken.replace(original,pronunciation)
        phonemes=tts.tokenizer.phonemize(spoken,SPEC['language'])
        if brand_alias:
            assert phonemes.count('pˈoʊz')==2 and 'dˈɑːt nˈɛt' in phonemes
        assert matcher.ratio() >= .88 or brand_alias, f"ASR review required: {p['id']} {differences}"
        offset,local_caps=0,[]
        for text in p['caption_phrases']:
            count=len(tokens(text))
            matched=[mapping[i] for i in range(offset,offset+count) if i in mapping]
            assert matched
            local_caps.append({'start':round(p['start']+max(0,matched[0]['start']),3),
                'end':round(p['start']+min(m['speech_seconds'],matched[-1]['end']+.12),3),
                'text':wrap_caption(text)})
            offset+=count
        # Hold each clause until the next starts, avoiding distracting blank flashes.
        local_caps[0]['start']=p['start']
        for a,b in zip(local_caps,local_caps[1:]):a['end']=b['start']
        caps.extend(local_caps)
        reports.append({'id':p['id'],'recognition_agreement':matcher.ratio(),'differences':differences,
            'recognized_text':' '.join(row['text'] for row in rows),'audio_sha256':digest(wav),
            'tts_phonemes':phonemes,'brand_asr_alias_checked_against_phonemes':brand_alias})
        print(json.dumps(reports[-1],ensure_ascii=True),flush=True)
    assert ' '.join(c['text'].replace('\n',' ') for c in caps)==script
    assert all(c['start']<c['end']<=116 for c in caps)
    assert all(a['end']<=b['start'] for a,b in zip(caps,caps[1:]))
    dump(OUT/'captions.json',caps)
    dump(OUT/'speech-check.json',{'voice':SPEC['voice'],'model':'Whisper base.en, no prompt','passages':reports})
    original_srt=(ROOT/'output/investor-exact-v4/PoseTek-Investor-Exact-V4.srt').read_text(encoding='utf-8')
    def seconds(stamp):
        h,m,s=stamp.replace(',','.').split(':');return int(h)*3600+int(m)*60+float(s)
    native_caps=[]
    for block in original_srt.strip().split('\n\n'):
        lines=block.splitlines();a,b=lines[1].split(' --> ')
        if 21.5<=seconds(a)<46.5:native_caps.append({'start':seconds(a),'end':seconds(b),'text':'\n'.join(lines[2:])})
    assert len(native_caps)==9
    all_caps=sorted(caps+native_caps,key=lambda c:c['start'])
    srt='\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(all_caps))+'\n'
    (OUT/'captions.srt').write_text(srt,encoding='utf-8')
    (DELIVERY/'PoseTek-Investor-V4-Copyedit.srt').write_text(srt,encoding='utf-8')
    narration=np.zeros(N)
    for p in SPEC['passages']:
        dest=WORK/f"{p['id']}-48k.wav"
        run_ffmpeg(['-i',WORK/f"{p['id']}.wav",'-af','highpass=f=75,lowpass=f=10500,acompressor=threshold=0.16:ratio=2:attack=15:release=120:makeup=1','-ar',SR,'-c:a','pcm_s24le',dest])
        samples,sr=sf.read(dest)
        active=samples[np.abs(samples)>.01]
        samples *= .13/max(np.sqrt(np.mean(active**2)),.0001)
        start=round(p['start']*SR)
        narration[start:start+len(samples)]+=samples
    sf.write(WORK/'narration-raw.wav',narration,SR,subtype='PCM_24')
    normalize(WORK/'narration-raw.wav',OUT/'narration.wav',-17)
    narration,_=sf.read(OUT/'narration.wav',always_2d=True)
    start,end=round(21.5*SR),round(46.5*SR)
    native,sr=sf.read(ROOT/'public/product/demo-audio.wav',always_2d=True)
    assert sr==SR and len(native)==end-start and not narration[start:end].any()
    native_stem=np.zeros((N,2));native_stem[start:end]=native
    sf.write(OUT/'native-isolated.wav',native_stem,SR,subtype='PCM_24')
    voice=np.repeat(narration,2,axis=1)+native_stem
    score,sr=sf.read(AUDIO/'work/investor-exact-v2/bed-leveled.wav',always_2d=True)
    assert sr==SR and len(score)>=N
    bed,_,_=ducked_score(score[:N],voice)
    vp,bp=blocks(voice,4800),blocks(bed,4800)
    voiced=vp>10**(-30/10)
    calibration=float(10*np.log10(vp[voiced].sum()/bp[voiced].sum()))-16
    bed *= 10**(calibration/20)
    sf.write(OUT/'bed.wav',bed,SR,subtype='PCM_24')
    raw=voice+bed
    sf.write(WORK/'mix-raw.wav',raw,SR,subtype='FLOAT')
    gain_db=-16-meter(WORK/'mix-raw.wav')['integrated_lufs']
    sf.write(WORK/'mix-gained.wav',raw*10**(gain_db/20),SR,subtype='FLOAT')
    run_ffmpeg(['-i',WORK/'mix-gained.wav','-af','alimiter=limit=0.8317637711:attack=5:release=50:level=0:latency=1','-ar',SR,'-c:a','pcm_s24le',OUT/'master.wav'])
    master,_=sf.read(OUT/'master.wav',always_2d=True)
    old,_=sf.read(ROOT/'public/audio-investor-exact-v4/master.wav',always_2d=True)
    master[start:end]=old[start:end]
    # Blend only outside the native 25-second demonstration.
    width=round(.04*SR);ramp=np.linspace(0,1,width)[:,None]
    master[start-width:start]=master[start-width:start]*(1-ramp)+old[start-width:start]*ramp
    master[end:end+width]=old[end:end+width]*(1-ramp)+master[end:end+width]*ramp
    sf.write(OUT/'master.wav',master,SR,subtype='PCM_24')
    master,_=sf.read(OUT/'master.wav',always_2d=True)
    assert np.array_equal(master[start:end],old[start:end])
    levels=meter(OUT/'master.wav')
    assert -16.5<=levels['integrated_lufs']<=-15.5 and levels['true_peak_dbtp']<=-1.5,levels
    assert all(digest(ROOT/path)==sha for path,sha in preserved.items())
    report={'passed':True,'version':SPEC['version'],'duration_seconds':116,'duration_frames':3480,'fps':30,
        'sample_rate':SR,'samples':N,'voice':SPEC['voice'],'synthesis_rate':SPEC['synthesis_rate'],
        'post_synthesis_speed_change':False,'word_count':len(script.split()),'narration_passages':10,
        'captions_exact_copyedit_script':True,'caption_cues':len(caps),'native_caption_cues':len(native_caps),
        'original_demo':{'start':21.5,'end':46.5,'mixed_pcm_identical_to_v4':True,'isolated_pcm_identical':True},
        'levels':levels,'preserved_exports_and_audio':preserved,'master_sha256':digest(OUT/'master.wav'),
        'music':'Existing score, continuously ducked; original V4 mixed audio retained across the demonstration.',
        'original_score_sha256':digest(AUDIO/'work/investor-exact-v2/bed-leveled.wav')}
    dump(OUT/'audio-manifest.json',report);dump(DELIVERY/'audio-validation.json',report)
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':main()

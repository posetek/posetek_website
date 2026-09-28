"""Verify a rendered weak-foot proof has exactly the intended soundtrack.

Usage: audio-source/.venv/Scripts/python.exe audio-source/weak_foot_v1_encoded_check.py movie.mp4
"""
from pathlib import Path
import argparse
import json
import subprocess
import numpy as np
import soundfile as sf
from weak_foot_v1_audio import ROOT, OUT, SR, digest, dump
from exact_v3_mix import meter


def alignment(reference, decoded, start, end):
    a, b = round(start*SR), round(end*SR)
    expected = reference[a:b].mean(axis=1)
    expected -= expected.mean()
    scores = []
    for lag in range(-32, 33):
        actual = decoded[a+lag:b+lag].mean(axis=1)
        actual -= actual.mean()
        corr = np.dot(expected,actual)/np.sqrt(np.dot(expected,expected)*np.dot(actual,actual))
        scores.append((float(corr),lag))
    corr, lag = max(scores)
    actual = decoded[a+lag:b+lag].mean(axis=1)
    actual -= actual.mean()
    gain = float(np.dot(expected,actual)/np.dot(expected,expected))
    error = actual-expected*gain
    return {'window_seconds':[start,end],'lag_samples':lag,'correlation':corr,
            'gain_db':float(20*np.log10(abs(gain))),
            'signal_to_error_db':float(10*np.log10(np.sum((expected*gain)**2)/np.sum(error**2)))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('movie',type=Path)
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    movie = args.movie.resolve()
    source = OUT/'master.wav'
    manifest = json.loads((OUT/'audio-manifest.json').read_text(encoding='utf-8'))
    assert digest(source) == manifest['audio']['master.wav']['sha256']
    reference,sr = sf.read(source,always_2d=True)
    assert sr == SR and reference.shape == (2880000,2)
    probe = json.loads(subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(movie)],capture_output=True,text=True,check=True).stdout)
    streams = [s for s in probe['streams'] if s['codec_type']=='audio']
    assert len(streams)==1, 'Field audio or duplicate soundtrack must not be muxed.'
    stream=streams[0]
    assert stream['codec_name']=='aac' and int(stream['sample_rate'])==SR and int(stream['channels'])==2
    assert abs(float(stream.get('start_time',0)))<=1/SR
    decoded=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-i',str(movie),'-map','0:a:0','-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True)
    data=np.frombuffer(decoded.stdout,dtype='<f4').reshape(-1,2).astype(np.float64)
    assert len(reference)<=len(data)<len(reference)+1024 and np.isfinite(data).all()
    windows={'opening_voice':[.2,2.2],'player1_right':[4.2,5.6],'player1_left':[8.7,10.2],
             'field_demo_music_only':[6,8],'player1_evidence':[15.7,20.7],
             'player2_right':[22.2,24.8],'player2_left':[26.7,27.5],
             'practice_cue':[39.2,45.6],'closing_voice':[49.2,56],'music_outro':[57.1,59.5]}
    checks={name:alignment(reference,data,*window) for name,window in windows.items()}
    for name,result in checks.items():
        assert result['lag_samples']==0, (name,result)
        assert result['correlation']>.99, (name,result)
        assert abs(result['gain_db'])<.15, (name,result)
    levels=meter(movie)
    assert -16.5<=levels['integrated_lufs']<=-15.5 and levels['true_peak_dbtp']<=-1, levels
    report={'passed':True,'version':'weak-foot-v1','movie':str(movie),'movie_sha256':digest(movie),
            'master_sha256':digest(source),'sample_rate':SR,'master_samples':len(reference),
            'aac_decoded_samples':len(data),'aac_padding_samples':len(data)-len(reference),
            'duration_seconds':float(stream['duration']),'encoding_lag_samples':0,
            'levels':levels,'alignment_checks':checks,'field_recordings_muted':True,
            'field_muting_evidence':'Rendered audio matches the sole mixed reference at reviewed windows.',
            'caption_source_unchanged':digest(OUT/'captions.json')==manifest['captions']['sha256']}
    assert report['caption_source_unchanged']
    receipt=args.output or movie.parent/'audio-encoded-validation.json'
    dump(receipt,report)
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':
    main()

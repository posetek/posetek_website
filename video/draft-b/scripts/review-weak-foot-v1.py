"""Encoded-picture checks and transition contact sheets; no source media edits."""
import json, subprocess, pathlib, numpy as np
from PIL import Image, ImageDraw
root=pathlib.Path(__file__).resolve().parents[1]
out=root/'output/weak-foot-v1'
proof=out/'PoseTek-Weak-Foot-Investor-V1-Timed-Proof.mp4'
def frames(path, wanted, width, height):
    select='+'.join(f'eq(n,{f})' for f in wanted)
    result=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-vf',f"select='{select}'",'-fps_mode','vfr','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,check=True)
    images=np.frombuffer(result.stdout,np.uint8).reshape(-1,height,width,3)
    assert len(images)==len(wanted),(path,len(images),wanted)
    return images
checks=[]
wanted=[490,550,600,640,1020,1100,1270,1400]
samples=frames(proof,wanted,720,1280)
for n in range(0,len(wanted),2):
    # Only the fixed pose viewport. Captions/controls outside this crop can change.
    a=samples[n][440:751,70:618].astype(float)
    b=samples[n+1][440:751,70:618].astype(float)
    mean=float(np.abs(a-b).mean());p99=float(np.percentile(np.abs(a-b),99))
    checks.append({'id':f'feedback-{wanted[n]}-{wanted[n+1]}','passed':mean<1.0 and p99<8,'meanEncodedPixelDifference':mean,'p99':p99})
boundaries=[120,255,390,462,564,660,795,930,1002,1170,1470,1519,1568,1617,1710]
for size in [720,1080]:
    for page in range((len(boundaries)+3)//4):
        canvas=Image.new('RGB',(720,4*350),(4,19,14));draw=ImageDraw.Draw(canvas)
        for row,boundary in enumerate(boundaries[page*4:page*4+4]):
            requested=[boundary-16,boundary-6,boundary+4,boundary+19]
            if size==720:imgs=frames(proof,requested,720,1280)
            else:
                video=out/f'boundary-{boundary}-1080.mp4'
                probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(video)]))['streams'][0]
                assert int(probe['nb_frames'])==36 and probe['width']==1080 and probe['height']==1920
                subprocess.run(['ffmpeg','-v','error','-i',str(video),'-f','null','-'],capture_output=True,check=True)
                imgs=frames(video,[0,10,20,35],1080,1920)
                checks.append({'id':f'boundary-{boundary}-1080','passed':True,'frames':36,'dimensions':[1080,1920]})
            draw.text((6,row*350+4),f'{size}p / transition {boundary/30:.2f}s',fill=(183,243,74))
            for col,im in enumerate(imgs):
                thumb=Image.fromarray(im).resize((176,313),Image.Resampling.LANCZOS)
                canvas.paste(thumb,(col*180,row*350+25))
        canvas.save(out/f'transitions-{size}-{page+1}.jpg',quality=92)
receipt={'passed':all(c['passed'] for c in checks),'checks':checks,'note':'Contact sheets are visual-review aids, not a substitute for inspecting original-size key frames.'}
(out/'visual-validation.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':receipt['passed'],'checks':len(checks),'feedback':checks[:4]},indent=2))
assert receipt['passed']

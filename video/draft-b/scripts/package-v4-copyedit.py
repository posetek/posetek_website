"""Package the copy-edited V4 and its sanitized render dependencies."""
from pathlib import Path
import hashlib,json,re,shutil,zipfile

ROOT=Path(__file__).resolve().parent.parent
REPO=ROOT.parent.parent
OUT=ROOT/'output/investor-v4-copyedit'
PACKAGE=OUT/'editable-source'
VIDEO=PACKAGE/'video/draft-b'
VIDEO.mkdir(parents=True,exist_ok=True)

def copy(path,dest=None):
    dest=dest or PACKAGE/path.relative_to(REPO)
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(path,dest)

seen=set()
def dependency(path):
    path=path.resolve()
    if path in seen:return
    assert path.is_relative_to(REPO)
    seen.add(path);copy(path)
    if path.suffix not in ['.ts','.tsx','.js','.jsx']:return
    specs=re.findall(r"(?:from\s*|import\s*)['\"](\.[^'\"]+)['\"]",path.read_text(encoding='utf-8'))
    for spec in specs:
        q=path.parent/spec
        choices=[q]+[q.with_suffix(ext) for ext in ['.ts','.tsx','.js','.jsx','.json']]+[q/('index'+ext) for ext in ['.ts','.tsx']]
        found=next((p for p in choices if p.is_file()),None)
        assert found, (path,spec)
        dependency(found)

dependency(ROOT/'src/InvestorV4CopyEdit.tsx')
copy(ROOT/'src/index.ts')
(VIDEO/'src/Root.tsx').write_text("""import React from 'react';
import {Composition} from 'remotion';
import {InvestorV4CopyEdit,V4_COPYEDIT_DURATION} from './InvestorV4CopyEdit';
export const Root=()=> <Composition id="PoseTekInvestorV4CopyEdit" component={InvestorV4CopyEdit} durationInFrames={V4_COPYEDIT_DURATION} fps={30} width={1920} height={1080}/>;
""",encoding='utf-8')
for name in ['package.json','package-lock.json','tsconfig.json','INVESTOR_V4_COPYEDIT.md','EXACT_INVESTOR_V4.md']:
    copy(ROOT/name)
copy(ROOT/'scripts/render-v4-copyedit.mjs')
copy(ROOT/'audio-source/investor-v4-copyedit.json')
assets=['figure-8.mp4','wall-pass.mp4','investor-exact-v2/preview-poses.json','product/screen-demo.mp4','investor-exact-v2/broadjump.json','investor-exact/profile.json','investor-exact/field-readiness.mp4','investor-exact/field-jump.mp4','investor-exact/technique.json','investor-exact-v3/cod.json']
assets+=['fonts/'+p.name for p in (ROOT/'public/fonts').glob('*.woff2')]
assets+=['audio-investor-v4-copyedit/'+p.name for p in (ROOT/'public/audio-investor-v4-copyedit').iterdir() if p.suffix in ['.wav','.json','.srt']]
for name in assets:copy(ROOT/'public'/name)
for name in ['audio-validation.json','master-validation.json','visual-review.json']:
    if (OUT/name).exists():copy(OUT/name,VIDEO/'verification'/name)
copy(OUT/'PoseTek-Investor-V4-Copyedit.srt',VIDEO/'captions.srt')
(PACKAGE/'README.md').write_text('''# PoseTek investor V4 — copy edit

116 seconds, 1920 × 1080, 30 fps. Same investor argument and earlier visual timings.
Grammar, phrasing and caption breaks are corrected. The outro adds “PoseTek.
Learn more at posetek.net.” and lasts three seconds longer. Previous videos remain
separate editions.

Install Node 22 and FFmpeg. In video/draft-b run:

    npm ci
    npm run typecheck
    node scripts/render-v4-copyedit.mjs master

Use a short extraction path on Windows. Optionally set REMOTION_BROWSER_EXECUTABLE
to an existing compatible Chrome executable.

The package contains only this composition and its render dependencies. App source
files are read-only visual dependencies. Included 48 kHz PCM audio and sanitized
recordings permit rendering without account access, TTS models or production writes.
master.wav is the sole soundtrack, including native app speech. Do not add field audio.
The original demonstration's mixed PCM is preserved from V4. bed.wav and narration.wav
document the new narration mix; use master.wav for the final matched demonstration.

See video/draft-b/INVESTOR_V4_COPYEDIT.md for exact before/after wording. Full caption
delivery includes the original app prompts. Earlier V4 provenance remains in
EXACT_INVESTOR_V4.md. No new athlete results or movement changes are represented.
''',encoding='utf-8')
files=[p for p in PACKAGE.rglob('*') if p.is_file() and p.name!='FILES.json']
manifest={p.relative_to(PACKAGE).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
(PACKAGE/'FILES.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
zip_path=OUT/'PoseTek-Investor-V4-Copyedit-Editable-Source.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for p in files+[PACKAGE/'FILES.json']:
        archive.write(p,'PoseTek-Investor-V4-Copyedit/'+p.relative_to(PACKAGE).as_posix())
with zipfile.ZipFile(zip_path) as archive:assert archive.testzip() is None
print(json.dumps({'file':str(zip_path),'bytes':zip_path.stat().st_size,'files':len(files)+1,'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest()}))

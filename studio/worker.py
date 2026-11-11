"""DAWG GAMMIT video studio worker.

Watches /data/videos/jobs/<id>/job.json (written by the admin, app/server.js) and renders each video:
  product photos -> voiceover -> 9:16 promo (engine/dgq.py + HyperFrames) -> final.mp4 + cover.jpg.
It writes its progress to status.json beside job.json and never edits job.json.

Private media (music, voiceover cuts, backgrounds) live in /data/studio-library, uploaded through the admin,
so they never go in this public repo.
Environment: DATA_DIR (/data), ELEVENLABS_API_KEY (optional: per-product voiceovers in the Andray voice).
"""
import base64, json, os, pathlib, re, shutil, subprocess, sys, time, traceback, urllib.request, zipfile
from io import BytesIO

DATA = pathlib.Path(os.environ.get("DATA_DIR", "/data"))
JOBS = DATA / "videos" / "jobs"
LIB = DATA / "studio-library"
HERE = pathlib.Path(__file__).resolve().parent
ENGINE = HERE / "engine" / "dgq.py"
ASSETS = pathlib.Path("/tmp/dg-assets")
EL_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ANDRAY = "FsK9b8Cv2pGkFUtfpOyM"          # ElevenLabs voice Robert approved on 11 Nov 2026
UA = "DawgGammitSite/1.0 (+https://dawggammit.com)"
HF = "hyperframes@0.8.206"
MAX_LEN = 15.0

def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)
def rj(p, d=None):
    try: return json.loads(pathlib.Path(p).read_text())
    except Exception: return d
def wj(p, o):
    p = pathlib.Path(p); t = p.with_suffix(".tmp"); t.write_text(json.dumps(o, indent=1)); t.replace(p)

# ---------- library: unpack an uploaded pack, then lay out the engine's asset folder ----------
def unpack_library():
    z = LIB / "incoming.zip"
    if not z.exists(): return
    try:
        with zipfile.ZipFile(z) as zf:
            for m in zf.infolist():
                name = m.filename.replace("\\", "/")
                parts = [p for p in name.split("/") if p not in ("", ".", "..")]
                if not parts or m.is_dir(): continue
                if parts[0] not in ("tracks", "vo", "posters"):           # the pack may have one wrapping folder
                    parts = parts[1:]
                if len(parts) != 2 or parts[0] not in ("tracks", "vo", "posters"): continue
                if not re.fullmatch(r"[A-Za-z0-9._-]+", parts[1]): continue
                dst = LIB / parts[0] / parts[1]; dst.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(m) as src, open(dst, "wb") as out: shutil.copyfileobj(src, out)
        log("library pack unpacked")
        wj(LIB / "library-status.json", {"ok": True, "at": time.time(), "message": "Library pack unpacked"})
    except Exception as e:
        log("library pack failed", e)
        wj(LIB / "library-status.json", {"ok": False, "at": time.time(), "message": f"That pack could not be unpacked: {e}"})
    z.unlink(missing_ok=True)

def build_assets():
    if ASSETS.exists(): shutil.rmtree(ASSETS)
    ASSETS.mkdir(parents=True)
    for d in ("fonts", "skel"): shutil.copytree(HERE / "assets" / d, ASSETS / d)
    for d in ("tracks", "vo", "posters"):
        (LIB / d).mkdir(parents=True, exist_ok=True)
        (ASSETS / d).symlink_to(LIB / d)

def tracks():
    t = rj(LIB / "tracks" / "tracks.json", {}) or {}
    for f in (LIB / "tracks").glob("*.mp3"):
        t.setdefault(f.stem, {"label": f.stem.replace("-", " ").title(), "drop": 0.0})
    return t

# ---------- product photos ----------
def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r: return r.read()

def product_photos(url):
    """Every product photo on the KoolTeez page, one size each, in page order."""
    h = fetch(url).decode("utf8", "replace").replace("\\/", "/").replace("&amp;", "&")
    og = re.search(r'<meta property="og:image" content="([^"]+)"', h)
    urls = ([og.group(1)] if og else []) + re.findall(r'https://imgproxy\.fourthwall\.dev/[^"\\ \']+', h)
    seen, out = {}, []
    for u in urls:
        key = (u.split("/enc/")[1] if "/enc/" in u else u).split(".")[0]
        w = int((re.search(r"/w:(\d+)/", u) or [0, 0])[1] or 0)
        if w < 700: continue
        if key not in seen: seen[key] = u; out.append(key)
        elif w > int((re.search(r"/w:(\d+)/", seen[key]) or [0, 0])[1] or 0): seen[key] = u
    return [seen[k] for k in out][:8]

def kind_of(img):
    from PIL import Image
    im = img.convert("RGBA").resize((24, 24))
    c = [im.getpixel(p) for p in [(0, 0), (23, 0), (0, 23), (23, 23)]]
    if any(x[3] < 50 for x in c): return "cut"
    if all(min(x[:3]) > 232 for x in c): return "flat"
    return "photo"

def get_photos(job, wd):
    from PIL import Image
    urls = []
    try: urls = product_photos(job["url"])
    except Exception as e: log("product page not read:", e)
    for u in (job.get("photos") or []):                 # what the shop admin already knows about this product
        if u and u not in urls: urls.append(u)
    found = []
    for i, u in enumerate(urls[:8]):
        try:
            im = Image.open(BytesIO(fetch(u))); im.load()
            k = kind_of(im); f = wd / f"photo{i}.png"; im.convert("RGBA" if k == "cut" else "RGB").save(f)
            found.append({"url": u, "kind": k, "file": str(f)})
        except Exception as e: log("photo failed", u[:80], e)
    if not found: raise RuntimeError("No product photos could be downloaded from the product page")
    return found

# ---------- voiceover ----------
OPENERS = ["The new Dawg Gammit Western collection!", "Straight outta the Dawg Gammit Western collection!", "Outlaws, listen up! The new Dawg Gammit Western collection!"]

def spoken(name):
    n = re.sub(r"(?i)dawg gammit(™)?", "", name).replace("T-shirt", "tee shirt").replace("&", "and")
    return re.sub(r"\s+", " ", n).strip().lower()

def andray_script(job):
    opener = OPENERS[job.get("seq", 0) % len(OPENERS)]
    return (f"[excited] {opener} [confident, playful] Nobody moves... nobody gets hurt. "
            f"Featuring this {spoken(job['name'])}. [hyped] Dawg! Gammit! K-9s bark it all the time, y'all! "
            f"[upbeat] Get yours from Dawg Gammit dot com!")

def eleven(text):
    last = None
    for model in ("eleven_v3", "eleven_multilingual_v2"):
        body = {"text": text if model == "eleven_v3" else re.sub(r"\[[^\]]*\]\s*", "", text), "model_id": model}
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{ANDRAY}/with-timestamps?output_format=mp3_44100_128",
                                     data=json.dumps(body).encode(), method="POST",
                                     headers={"xi-api-key": EL_KEY, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r: d = json.loads(r.read())
            return base64.b64decode(d["audio_base64"]), (d.get("normalized_alignment") or d.get("alignment")), model
        except urllib.error.HTTPError as e:
            last = f"{model}: {e.code} {e.read()[:300]!r}"; log("ElevenLabs", last)
        except Exception as e:
            last = f"{model}: {e}"; log("ElevenLabs", last)
    raise RuntimeError("ElevenLabs did not make the voiceover (" + str(last) + ")")

def audio_len(f):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)], capture_output=True, text=True).stdout
    return float(out.strip() or 0)

def make_andray(job, wd):
    text = andray_script(job)
    audio, al, model = eleven(text)
    (wd / "vo-raw.mp3").write_bytes(audio)
    chars = al["characters"]; st = al["character_start_times_seconds"]; en = al["character_end_times_seconds"]
    s = "".join(chars).lower()
    def at(word, after=0, end=False):
        i = s.find(word, after)
        if i < 0: raise RuntimeError(f'Timing for "{word}" not found in the voiceover')
        return (en[i + len(word) - 1] if end else st[i]), i
    nob, i1 = at("nobody moves"); feat, i2 = at("featuring", i1); dawg, i3 = at("dawg", i2)
    gam, i4 = at("gammit", i3); k9, i5 = at("k", i4 + 6); get, i6 = at("get yours", i5); url, _ = at("dot com", i6)
    speech_end = en[len(en) - 1 - next(k for k, c in enumerate(reversed(chars)) if c.strip())]
    # trim the tail, then speed up a little if the whole thing would run past 15 s
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wd / "vo-raw.mp3"), "-t", f"{speech_end + 0.15:.2f}", "-ac", "1", "-ar", "44100", str(wd / "vo-trim.wav")], check=True)
    ln = audio_len(wd / "vo-trim.wav"); budget = MAX_LEN - 0.3 - 0.6 - 0.1
    f = max(1.0, min(1.15, ln / budget))
    if f > 1.0:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wd / "vo-trim.wav"), "-filter:a", f"atempo={f:.3f}", str(wd / "vo.wav")], check=True)
    else: shutil.copy(wd / "vo-trim.wav", wd / "vo.wav")
    sc = lambda t: round(t / f, 3)
    cues = {"captions": [[sc(nob), sc(feat) - 0.05, "Nobody moves…<br/>nobody gets hurt."],
                         [sc(k9), sc(get) - 0.05, "K9's Bark It All The Time,<br/>Y'all!"]],
            "name_at": [sc(feat), sc(dawg) - 0.1], "dawg": sc(dawg), "gammit": sc(gam),
            "flips": [sc(feat) + 0.5, sc(dawg) - 0.15], "end": sc(get), "url": sc(url), "len": round(audio_len(wd / "vo.wav"), 3)}
    wj(wd / "cues.json", cues)
    return {"script": text, "model": model, "speed": round(f, 3)}

# ---------- one job ----------
def render(job, jd, set_status):
    wd = jd / "work"
    if wd.exists(): shutil.rmtree(wd)
    wd.mkdir(parents=True)
    set_status("rendering", "Getting the product photos")
    photos = get_photos(job, wd)
    flats = [p for p in photos if p["kind"] in ("cut", "flat")]
    worn = [p for p in photos if p["kind"] == "photo"]
    pick = lambda u: next((p for p in photos if p["url"] == u), None)
    front = pick(job.get("front")) or (flats[0] if flats else photos[0])
    back = pick(job.get("back")) if job.get("back") else (next((p for p in flats if p is not front), None))
    if job.get("back") == "none": back = None
    thumb = None
    if job.get("thumb"):
        t = DATA / "videos" / "thumbs" / job["thumb"]
        if t.exists(): thumb = str(t)
    elif job.get("autoThumb", True) and worn:
        thumb = worn[0]["file"]                         # a photo of someone wearing it makes a strong cover

    voice = job.get("voice", "andray")
    extra, info = [], {}
    if voice == "andray":
        if not EL_KEY: raise RuntimeError("The Andray voice needs ELEVENLABS_API_KEY on the server. Choose Cowboy or Cowgirl, or add the key.")
        set_status("rendering", "Recording the voiceover")
        info = make_andray(job, wd)
        extra = ["--vo", str(wd / "vo.wav"), "--cues", str(wd / "cues.json")]
    else:
        extra = ["--voice", "cowgirl" if voice == "cowgirl" else "cowboy", "--length", job.get("length", "full")]

    tr = tracks(); tname = job.get("track") or next(iter(tr), None)
    if not tname or not (LIB / "tracks" / f"{tname}.mp3").exists():
        raise RuntimeError("No background track in the library yet. Upload the library pack in Videos → Settings.")
    hold = 3.0 if thumb else 0.0
    start = max(0.0, float(tr.get(tname, {}).get("drop", 0)) - hold)
    bg = job.get("background") or "blank-parchment"
    if not (LIB / "posters" / f"{bg}.jpg").exists(): bg = "blank-parchment"
    if not (LIB / "posters" / f"{bg}.jpg").exists(): raise RuntimeError("No backgrounds in the library yet. Upload the library pack in Videos → Settings.")

    set_status("rendering", "Building the video")
    proj = wd / "proj"
    cmd = [sys.executable, str(ENGINE), "--name", job["name"], "--front", front["file"], "--track-file", str(LIB / "tracks" / f"{tname}.mp3"),
           "--track-start", f"{start:.2f}", "--background", bg, "--collection", job.get("collection") or "WESTERN COLLECTION",
           "--tagline", job.get("tagline") or "Nobody Moves, Nobody Gets Hurt", "--out", str(proj)] + extra
    if back: cmd += ["--back", back["file"]]
    if thumb: cmd += ["--thumb", thumb]
    if job.get("price") and job.get("showPrice", True): cmd += ["--price", job["price"]]
    r = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "DG_ASSETS": str(ASSETS)})
    if r.returncode: raise RuntimeError("Building the video failed: " + (r.stderr or r.stdout)[-600:])
    timing = rj(proj / "timing.json", {})
    if timing.get("total", 0) > MAX_LEN + 0.05: raise RuntimeError(f"The video came out at {timing['total']} s, over 15 s")

    set_status("rendering", "Rendering (about a minute)")
    r = subprocess.run(["npx", "--yes", HF, "render"], cwd=proj, capture_output=True, text=True, timeout=900)
    mp4s = sorted((proj / "renders").glob("*.mp4"))
    if r.returncode or not mp4s: raise RuntimeError("Rendering failed: " + (r.stderr or r.stdout)[-600:])

    set_status("rendering", "Finishing the file")
    out = jd / "video.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4s[-1]), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)], check=True)
    cover = jd / "cover.jpg"
    if thumb:
        from PIL import Image
        Image.open(proj / "assets" / "thumb.jpg").convert("RGB").save(cover, quality=90)
    else:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-frames:v", "1", "-q:v", "2", str(cover)], check=True)
    shutil.rmtree(proj / "renders", ignore_errors=True)
    return {"duration": round(audio_len(out), 2), "bytes": out.stat().st_size, "photos": [{"url": p["url"], "kind": p["kind"]} for p in photos],
            "used": {"front": front["url"], "back": back["url"] if back else None, "thumb": "upload" if job.get("thumb") else ("auto" if thumb else None),
                     "track": tname, "trackStart": round(start, 2), "background": bg, "voice": voice}, **info}

def main():
    log("DAWG GAMMIT studio worker starting; ElevenLabs", "on" if EL_KEY else "off")
    JOBS.mkdir(parents=True, exist_ok=True); LIB.mkdir(parents=True, exist_ok=True)
    (DATA / "videos" / "thumbs").mkdir(parents=True, exist_ok=True)
    # warm the renderer once so the first video does not wait for the download
    subprocess.run(["npx", "--yes", HF, "--version"], capture_output=True)
    while True:
        try:
            unpack_library(); build_assets()
            todo = []
            for jd in JOBS.iterdir():
                job = rj(jd / "job.json"); st = rj(jd / "status.json", {}) or {}
                if not job or job.get("deleted"): continue
                if st.get("rev") != job.get("rev", 1) or st.get("state") == "rendering":
                    todo.append((job.get("created", ""), jd, job))
            if todo:
                _, jd, job = sorted(todo, key=lambda x: x[0])[0]
                rev = job.get("rev", 1)
                def set_status(state, step, **kw):
                    wj(jd / "status.json", {"rev": rev, "state": state, "step": step, "at": time.time(), **kw})
                log("render", jd.name, job.get("name"))
                try:
                    res = render(job, jd, set_status)
                    set_status("ready", "Ready to review", **res)
                    log("ready", jd.name, res.get("duration"))
                except Exception as e:
                    traceback.print_exc()
                    set_status("failed", str(e)[:900])
                continue
        except Exception:
            traceback.print_exc()
        time.sleep(4)

if __name__ == "__main__":
    main()

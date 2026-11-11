"""DAWG GAMMIT quick promo: 9:16, 8-15 s. Everything that matters sits inside the social-app safe area
(nothing below y=1570, where Reels/TikTok put captions and the player timeline).
Generic voice:  python3 dgq.py --name NAME --front F [--back B] [--thumb T] [--price '$70'] [--voice cowboy|cowgirl]
                [--length full|short] [--track laidback|night-shift|smooth-cruise] --out DIR
Custom voice:   add --vo VOICE.wav --cues CUES.json [--vo-at 0.3] [--track-file F --track-start S]
Thumbnail:      --thumb T opens the video for --thumb-hold seconds (default 3) and closes it for --end-hold seconds (default 2).
Render: cd DIR && npx --yes hyperframes@0.8.206 render"""
import argparse, json, pathlib, shutil, subprocess, wave
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("--name", required=True); ap.add_argument("--front", required=True); ap.add_argument("--back")
ap.add_argument("--thumb"); ap.add_argument("--price", default=""); ap.add_argument("--collection", default="WESTERN COLLECTION")
ap.add_argument("--voice", default="cowboy", choices=["cowboy", "cowgirl"]); ap.add_argument("--length", default="full", choices=["full", "short"])
ap.add_argument("--track", default="laidback", choices=["laidback", "night-shift", "smooth-cruise"])
ap.add_argument("--background", default="blank-parchment")
ap.add_argument("--tagline", default="Nobody Moves, Nobody Gets Hurt")
ap.add_argument("--vo"); ap.add_argument("--cues"); ap.add_argument("--vo-at", type=float, default=0.3)
ap.add_argument("--thumb-hold", type=float, default=3.0); ap.add_argument("--end-hold", type=float, default=2.0)
ap.add_argument("--track-file"); ap.add_argument("--track-start", type=float)
ap.add_argument("--out", required=True)
a = ap.parse_args()
import os
ROOT = pathlib.Path(__file__).resolve().parent.parent; AS = pathlib.Path(os.environ.get("DG_ASSETS") or ROOT / "assets")
P = pathlib.Path(a.out); A = P / "assets"; A.mkdir(parents=True, exist_ok=True)
W, H, SR = 1080, 1920, 44100
INK, RUST, TAN = "#2a1709", "#8a2a12", "#7a4a22"
TRACK_START = {"laidback": 11.25, "night-shift": 0.0, "smooth-cruise": 0.0}   # laidback starts on its drop
STAMP_MAX = 1.9                                                              # the DAWG GAMMIT! sign shows for under 2 s

# ---------- product images: cut out shop photos on white ----------
def cutout(src, dst):
    im = Image.open(src).convert("RGBA")
    if im.getextrema()[3][0] < 250:
        im.crop(im.getbbox()).save(dst); return "png"
    rgb = np.asarray(im.convert("RGB")).astype(int)
    white = (rgb.min(2) > 232) & (rgb.max(2) - rgb.min(2) < 18)
    lab, _ = ndimage.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ndimage.binary_fill_holes(~np.isin(lab, list(edge)))
    if not 0.12 < fg.mean() < 0.92:
        im.convert("RGB").save(dst); return "card"
    fg = ndimage.binary_opening(fg, iterations=2)
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(alpha); im = im.crop(alpha.getbbox()); im.save(dst); return "cut"
kinds = {"front": cutout(a.front, A / "front.png")}
if a.back: kinds["back"] = cutout(a.back, A / "back.png")
print("images:", kinds)
card = lambda k: kinds.get(k) == "card"
if a.thumb:
    t = Image.open(a.thumb).convert("RGB"); r = max(W / t.width, H / t.height)
    fill = t.resize((round(t.width * r), round(t.height * r))).filter(ImageFilter.GaussianBlur(40))
    fill = fill.crop(((fill.width - W) // 2, (fill.height - H) // 2, (fill.width - W) // 2 + W, (fill.height - H) // 2 + H))
    r = min(W / t.width, H / t.height); t2 = t.resize((round(t.width * r), round(t.height * r)), Image.LANCZOS)
    fill.paste(t2, ((W - t2.width) // 2, (H - t2.height) // 2)); fill.save(A / "thumb.jpg", quality=93)
shutil.copy(AS / "posters" / f"{a.background}.jpg", A / "bg.jpg")
(A / "fonts").mkdir(exist_ok=True)
for f in (AS / "fonts").iterdir(): shutil.copy(f, A / "fonts" / f.name)

# ---------- timing ----------
T0 = a.thumb_hold if a.thumb else 0.0
if a.vo:
    CU = json.load(open(a.cues)); VK = pathlib.Path(a.vo).name; O = a.vo_at
    M = {"dg": CU["dawg"], "part2": CU["end"], "urlword": CU["url"], "end": CU["len"]}
else:
    CU = None; VK = f"{a.voice}-{a.length}"; M = json.load(open(AS / "vo/timings.json"))[VK]
    O = 0.3 if a.thumb else 0.4             # with a thumbnail the voice starts over it ...
    if a.thumb and O + M["dg"] < T0 + 0.5:  # ... unless "Dawg Gammit!" would land under the thumbnail
        O = round(T0 + 0.5 - M["dg"], 2)
vt = lambda k: round(O + (M[k] if isinstance(k, str) else k), 3)
TOTAL = round(O + M["end"] + 0.6, 2)
TE = round(TOTAL - a.end_hold, 2) if a.thumb else TOTAL   # closing thumbnail
DG = vt("dg"); GM = vt(CU["gammit"]) if CU and "gammit" in CU else None
SOFF = round(DG + STAMP_MAX, 2)
print("voice", VK, "total", TOTAL, "s; thumbnail", T0, "s in,", a.end_hold if a.thumb else 0, "s out")

# ---------- layout (1080x1920; the safe area ends at y=1570) ----------
CSS = f"""@font-face{{font-family:"Rye";src:url("assets/fonts/Rye.woff2") format("woff2")}}
@font-face{{font-family:"Barlow Condensed";src:url("assets/fonts/barlow-condensed-latin-700-normal.woff2") format("woff2");font-weight:700}}
@font-face{{font-family:"ChunkFive";src:url("assets/fonts/ChunkFive.woff2") format("woff2")}}
@font-face{{font-family:"Special Elite";src:url("assets/fonts/SpecialElite.woff2") format("woff2")}}
*{{margin:0;padding:0;box-sizing:border-box}} html,body{{width:{W}px;height:{H}px;overflow:hidden;background:#1a0e05}}
#root{{position:relative;width:{W}px;height:{H}px;overflow:hidden;font-family:"Barlow Condensed",sans-serif;color:{INK};background:#1a0e05}}
.full{{position:absolute;left:0;top:0;width:{W}px;height:{H}px}} .bg{{position:absolute;left:0;top:0;width:{W}px;height:{H}px;object-fit:cover}}
.rye{{font-family:"Rye",serif}} .chunk{{font-family:"ChunkFive",serif}}
.tm{{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:.3em;vertical-align:top;position:relative;top:.12em;margin-left:.06em}} .typ{{font-family:"Special Elite",monospace}} .ctr{{position:absolute;left:40px;width:1000px;text-align:center}}
.pw{{position:absolute;left:10px;top:292px;width:1060px;height:1040px;display:flex;align-items:center;justify-content:center}}
#pf{{width:100%;height:100%;display:flex;align-items:center;justify-content:center}}
.pw img{{max-width:100%;max-height:100%;object-fit:contain;display:block;filter:drop-shadow(0 30px 26px rgba(60,30,8,.35))}}
.pw img.card{{max-width:86%;max-height:92%;border:14px solid #fbf3e2;box-shadow:0 26px 40px rgba(40,18,6,.4);transform:rotate(-2deg);filter:none}}
.cap{{position:absolute;left:40px;width:1000px;top:1326px;height:140px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}}
.stamp{{position:absolute;left:150px;top:640px;width:780px;padding:24px 0 28px;border:12px double {RUST};border-radius:18px;text-align:center;
 font-family:"ChunkFive",serif;font-size:138px;line-height:1.02;color:{RUST};background:rgba(246,230,198,.88);transform:rotate(-8deg);box-shadow:0 18px 40px rgba(40,18,6,.35)}}
.url{{position:absolute;left:170px;top:1474px;width:740px;height:92px;border-radius:46px;background:linear-gradient(180deg,#4a2c14 0%,#2a1709 100%);
 border:4px solid #b8935a;box-shadow:0 10px 26px rgba(30,14,4,.45);text-align:center;font-family:"Rye",serif;font-size:58px;line-height:84px;color:#f1dcb5}}"""
img = lambda k: f'<img class="{"card" if card(k) else ""}" src="assets/{k}.png" alt="" />'
cap = lambda i, txt, size=None: f'<div class="cap"><div id="{i}" class="typ" style="font-size:{size or (54 if len(txt) < 30 else 46)}px;line-height:1.18">{txt}</div></div>'
caps = ""
if CU:
    for i, (t1, t2, txt) in enumerate(CU["captions"]): caps += cap(f"cx{i}", txt)
else:
    if a.length == "full":
        caps += f'<div class="cap" id="cp1"><div id="c1" class="typ" style="font-size:54px;margin:4px">You want to say it…</div><div id="c2" class="typ" style="font-size:54px;margin:4px">…but you can\'t.</div></div>'
        caps += cap("c3", "Well, now you can.", 58)
    caps += cap("ck9", "K9's Bark It All The Time™", 54)
price = f'<span style="color:{RUST}"> · {a.price}</span>' if a.price else ""
for i in (["nm1", "nm2"] if CU and "name_at" in CU else ["nm2"]):   # product name + price: with "featuring…" (custom script) and at the end
    caps += f'<div class="cap"><div id="{i}" class="rye" style="font-size:{50 if len(a.name) < 30 else 44}px;line-height:1.14">{a.name}{price}</div></div>'
back = f'<div id="pbw" class="pw" style="opacity:0">{img("back")}</div>' if a.back else ""
glow = "rgba(244,222,176,.92)" if a.background == "blank-parchment" else "rgba(246,226,186,.9)"
page = f'''<img class="bg" src="assets/bg.jpg" alt="" />
<div style="position:absolute;left:0;top:80px;width:{W}px;height:230px;background:radial-gradient(ellipse 55% 50% at 50% 50%,{glow} 0%,rgba(244,222,176,0) 100%)"></div>
<div class="ctr chunk" style="top:100px;font-size:90px;line-height:1;color:{RUST}">DAWG GAMMIT<span class="tm">™</span></div>
<div class="ctr" style="top:198px;font-weight:700;font-size:36px;letter-spacing:9px;color:{TAN}">NEW {a.collection}</div>
<div class="ctr chunk" style="top:238px;font-size:46px;line-height:1;color:#3a2414">{a.tagline}</div>
<div style="position:absolute;left:0;top:1300px;width:{W}px;height:200px;background:radial-gradient(ellipse 62% 56% at 50% 50%,{glow} 0%,rgba(244,222,176,.75) 55%,rgba(244,222,176,0) 100%)"></div>
<div id="pfw" class="pw"><div id="pf">{img("front")}</div></div>{back}
<div id="stp" class="stamp" style="opacity:0"><span id="sd" style="display:inline-block">DAWG</span><br/><span id="sg" style="display:inline-block">GAMMIT!</span></div>{caps}
<div id="flash" class="full" style="background:#fff3dc;opacity:0"></div>'''
def clip(i, s, d, z, inner):
    return f'<div id="{i}" class="clip full" data-start="{s:.2f}" data-duration="{d:.2f}" data-track-index="{z}" data-track-kind="graphics" style="z-index:{z}" data-layout-allow-occlusion data-layout-allow-overlap data-layout-allow-overflow>{inner}</div>'
clips = [clip("page", 0, TOTAL, 30, page)]
if a.thumb:
    clips.append(clip("thumb", 0, T0, 40, '<img id="timg" class="bg" src="assets/thumb.jpg" alt="" />'))
    clips.append(clip("thumbend", TE, TOTAL - TE, 41, '<img id="eimg" class="bg" src="assets/thumb.jpg" alt="" />'))
# the DawgGammit.com button sits above everything from the first product frame to the end (over the closing thumbnail too)
clips.append(clip("cta", T0, TOTAL - T0, 50, '<div id="pfu" class="url">DawgGammit.com</div>'))

J = []; js = J.append
def ft(sel, frm, to, at): js(f'tl.fromTo({sel}, {{ {frm} }}, {{ immediateRender: false, {to} }}, {at:.2f});')
def show(sel, at, until, pop=True):
    at = max(at, T0 + 0.05)
    if until <= at + 0.3: return
    js(f'tl.from("{sel}", {{ opacity: 0, {"scale: 1.3" if pop else "y: 24"}, duration: 0.3, ease: "{"back.out(2)" if pop else "power3.out"}" }}, {at:.2f});')
    js(f'tl.to("{sel}", {{ opacity: 0, duration: 0.18 }}, {until - 0.18:.2f});')
def flip(out_, in_, at):
    if at < T0 + 0.3: return
    js(f'tl.to("{out_}", {{ opacity: 0, rotationY: 80, duration: 0.2, ease: "power2.in" }}, {at - 0.2:.2f});')
    ft(f'"{in_}"', "opacity: 0, rotationY: -80", 'opacity: 1, rotationY: 0, duration: 0.4, ease: "power3.out"', at)
js('tl.set(["#pfw","#pbw"], { transformPerspective: 1800 }, 0);')
if a.thumb:
    # clean cuts in and out of the thumbnail: two garment prints must never show through each other
    js(f'tl.fromTo("#timg", {{ scale: 1 }}, {{ scale: 1.05, duration: {T0:.2f}, ease: "none" }}, 0);')
    js(f'tl.from("#pfw", {{ scale: 1.25, duration: 0.35, ease: "power3.out" }}, {T0:.2f});')
    ft('"#eimg"', "scale: 1.08", 'scale: 1, duration: 0.5, ease: "power2.out"', TE)
    js(f'tl.from("#pfu", {{ opacity: 0, y: 30, duration: 0.35, ease: "power3.out" }}, {T0 + 0.15:.2f});')
else:
    js('tl.fromTo("#pfw", { scale: 1.06 }, { scale: 1, duration: 0.6, ease: "power2.out" }, 0);')
P2 = vt("part2"); END = TE
if CU:
    for i, (t1, t2, txt) in enumerate(CU["captions"]): show(f"#cx{i}", vt(t1), vt(t2))
    if "name_at" in CU: show("#nm1", vt(CU["name_at"][0]), vt(CU["name_at"][1]), pop=False)
    if a.back:
        for k, t in enumerate(CU.get("flips", [])): flip(*(("#pfw", "#pbw") if k % 2 == 0 else ("#pbw", "#pfw")), vt(t))
else:
    if a.length == "full":
        show("#c1", vt("l3"), vt("say") - 0.05); show("#c2", vt("l4"), vt("say") - 0.05)
        show("#c3", vt("say"), DG - 0.05)
        if a.back: flip("#pfw", "#pbw", vt("l4")); flip("#pbw", "#pfw", DG - 0.05)
    show("#ck9", vt("k9h"), P2 - 0.1)
    if a.length == "short" and a.back: flip("#pfw", "#pbw", SOFF + 0.1); flip("#pbw", "#pfw", P2)
show("#nm2", P2 - 0.1, END + 0.3, pop=False)
# DAWG GAMMIT! stamp: one hit, or DAWG ... GAMMIT! on two hits; gone within STAMP_MAX
ft('"#stp"', "opacity: 0, scale: 2.2", 'opacity: 1, scale: 1, duration: 0.22, ease: "power4.in"', DG - 0.18)
if GM:
    js('tl.set("#sg", { opacity: 0 }, 0);')
    ft('"#sg"', "opacity: 0, scale: 2", 'opacity: 1, scale: 1, duration: 0.2, ease: "power4.in"', GM - 0.15)
    ft('"#stp"', "rotation: -8", 'rotation: -4, duration: 0.3, ease: "elastic.out(1.2,0.3)"', GM + 0.05)
js(f'tl.to("#stp", {{ opacity: 0, scale: 0.85, duration: 0.2, ease: "power2.in" }}, {SOFF - 0.2:.2f});')
ft('"#flash"', "opacity: 0.5", 'opacity: 0, duration: 0.35', DG + 0.04)
ft('"#page"', "x: -14, y: 8", 'x: 0, y: 0, duration: 0.35, ease: "elastic.out(1.2,0.3)"', DG + 0.04)
ft('"#pfu"', "scale: 1", 'scale: 1.12, duration: 0.25, yoyo: true, repeat: 1, ease: "power2.out"', vt("urlword"))
ft('"#pf"', "scale: 1", f'scale: 1.04, duration: {max(0.5, END - P2):.2f}, ease: "none"', P2)

# ---------- audio ----------
def load(p, ch):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-f", "s16le", "-ac", str(ch), "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(float).reshape(-1, ch) / 32768
N = int(TOTAL * SR)
ts = a.track_start if a.track_start is not None else (0.0 if a.track_file else TRACK_START[a.track])
mus = load(a.track_file or AS / "tracks" / f"{a.track}.mp3", 2)[int(ts * SR):][:N]
music = np.zeros((N, 2)); music[:len(mus)] = mus
vo = load(a.vo or AS / "vo" / f"{VK}.wav", 1)[:, 0]; vo = 0.9 * vo / (np.abs(vo).max() + 1e-9)
voa = np.zeros(N); s = int(O * SR); voa[s:s + len(vo)] = vo[:N - s]
env = np.convolve((np.abs(voa) > 0.02).astype(float), np.ones(int(SR * .5)) / (SR * .5), mode="same"); env = np.clip(env * 4, 0, 1)
music *= (0.13 / (np.sqrt((mus ** 2).mean()) + 1e-9)) * (1 - 0.6 * env)[:, None]
fx = np.zeros(N); L = int(.5 * SR); tt = np.arange(L) / SR; rng = np.random.default_rng(7)
st = .8 * np.exp(-tt * 14) * np.sin(2 * np.pi * (55 + 120 * np.exp(-tt * 30)) * tt) + .2 * np.exp(-tt * 40) * rng.uniform(-1, 1, L)
for hit in [DG] + ([GM] if GM else []):
    i0 = int(hit * SR); fx[i0:i0 + L] += st[:N - i0]
mix = music + (voa + .5 * fx)[:, None]
mix *= np.minimum(1, (N - np.arange(N)) / (SR * 0.6))[:, None]
mix = mix / max(1, np.abs(mix).max() / .95)
with wave.open(str(A / "mix.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(A / "mix.wav"), "-b:a", "192k", str(A / "mix.mp3")], check=True)
(A / "mix.wav").unlink()

# ---------- write ----------
for fn in ("hyperframes.json", "package.json"): shutil.copy(AS / "skel" / fn, P / fn)
json.dump({"id": P.name, "name": P.name, "createdAt": "2026-11-11T12:00:00Z"}, open(P / "meta.json", "w"))
(P / "index.html").write_text(f'''<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width={W}, height={H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><style>{CSS}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL:.2f}" data-width="{W}" data-height="{H}">
<audio id="mix" src="assets/mix.mp3" data-start="0" data-duration="{TOTAL:.2f}" data-track-index="0"></audio>
{chr(10).join(clips)}
</div><script>
window.__timelines = window.__timelines || {{}};
const tl = gsap.timeline({{ paused: true }});
{chr(10).join(J)}
window.__timelines["main"] = tl; tl.seek(0);
</script></body></html>''')
mid = [round(T0 + 0.6, 2), round(DG - 0.5, 2), round(DG + 0.9, 2), round(SOFF + 0.4, 2), round(P2 + 0.5, 2)]
json.dump({"total": TOTAL, "dg": DG, "stamp_off": SOFF, "part2": P2, "end_thumb": TE if a.thumb else None,
           "check_times": [0] + mid + [round(TOTAL - 0.3, 2)]}, open(P / "timing.json", "w"))
print("written", P, "| stamp", DG, "->", SOFF, "| end thumbnail from", TE)

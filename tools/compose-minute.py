# 녹화 프레임 → 결선용 1분 시연 영상 (1920×1080, 30fps, 무음)
#   python -I tools/compose-minute.py            (입력 tools/out/minute)
# 서비스 화면이 영상 전체를 채우고, 장 제목은 왼쪽 위 카드로 미끄러져 들어온다.
# 확대 구간은 녹화 때 찍은 2배 스틸에서 잘라 선명하게, 포인터와 클릭 표시는 여기서 그린다.
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

SRC = Path("tools/out/minute")
OUT = SRC / "hanmankeum-demo-60s.mp4"
W, H, FPS = 1920, 1080, 30
FADE = 0.4                            # 장면 전환 디졸브
ZIN, ZOUT, ZMAX = 0.55, 0.45, 2.0     # 확대 들어가기·나오기(초), 최대 배율
CARD_IN, CARD_OUT = 0.45, 0.3         # 장 제목 카드 들어오기·나가기(초)
LAST_MAX = 8.0                        # 마지막 장면은 8초에서 끝낸다 (전체 60±3초)
SAFE = 128                            # 확대 화면 맨 위는 장 제목 자리라 비워 둔다 (영상 px)

# 자막 — 시나리오 문구 그대로 (바꾸지 말 것)
CAPTIONS = [
    "교수님이 확정한 평가기준",
    "AI 분류 ≠ 규칙 판단 → 확인 필요",
    "AI 판단 · 규칙 판단 · 이유",
    "원본을 보고 교수가 결정",
    "수정 전 판단도 보존",
    "온라인 기록 0% ≠ 기여 0%",
    "자기 기술·동료 증언은 수치와 분리",
    "기여율과 근거를 함께",
]
NOTICE = "시연 팀: 실제 저장소 커밋·PR 사용 / 팀원 배정·분류·기여율은 설명용 예시"
NOTICE_SEC = 3.0

# 서비스 색 그대로 (public/style.css: --bg #f5f5fa · --ink #262b3e · --muted #7b8091 · --blue #4b7cf3)
BG, INK, DIM, BLUE = (245, 245, 250), (38, 43, 62), (123, 128, 145), (75, 124, 243)

NOTO = "C:/Windows/Fonts/NotoSansKR-VF.ttf"


def noto(size, weight):
    f = ImageFont.truetype(NOTO, size)
    f.set_variation_by_axes([weight])
    return f


F_TITLE, F_NUM, F_NOTE = noto(46, 800), noto(24, 800), noto(19, 500)

tl = json.loads((SRC / "timeline.json").read_text(encoding="utf-8"))
VW, VH = tl["viewport"]
frames, scenes, zooms = tl["frames"], tl["scenes"], tl["zooms"]
MOUSE, CLICKS = tl["mouse"], tl["clicks"]
if len(scenes) != len(CAPTIONS):
    sys.exit(f"장면 수가 다릅니다: 녹화 {len(scenes)} / 자막 {len(CAPTIONS)}")
if (VW, VH) != (W, H):
    sys.exit(f"녹화 화면 {VW}x{VH} 가 영상 크기와 다릅니다")

T0 = scenes[0]["t0"]
scenes[-1]["t1"] = min(scenes[-1]["t1"], scenes[-1]["t0"] + LAST_MAX)
TOTAL = scenes[-1]["t1"] - T0
bounds = [s["t0"] - T0 for s in scenes] + [TOTAL]


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def lerp_rect(a, b, k):
    return tuple(p + (q - p) * k for p, q in zip(a, b))


# ── 녹화 프레임 (화면이 안 바뀌면 프레임이 오지 않으므로 직전 프레임을 쓴다)
src_times = [f["t"] for f in frames]
_cache = {"i": None, "img": None}


def frame_at(t):
    lo, hi = 0, len(src_times) - 1
    if t <= src_times[0]:
        idx = 0
    else:
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if src_times[mid] <= t:
                lo = mid
            else:
                hi = mid - 1
        idx = lo
    if _cache["i"] != idx:
        _cache["img"] = Image.open(SRC / "frames" / f"f{idx:06d}.jpg").convert("RGB")
        _cache["i"] = idx
    return _cache["img"]


_stills = {}


def still(name):
    if name not in _stills:
        _stills[name] = Image.open(SRC / name).convert("RGB")
    return _stills[name]


FULL = (0.0, 0.0, float(W), float(H))   # 화면 px


def fit(x, y, w, h, limit_w, limit_h, minw):
    """상자를 16:9 로 넓히고 최대 배율을 넘지 않게, 영역 안에 들어오게 맞춘다.
    상자 윗변이 확대 화면에서 SAFE 아래로 오도록 위쪽 여백을 둔다 (카드에 안 가리게)."""
    ar = W / H
    top, bottom = y, y + h
    for _ in range(3):
        rw, rh = (w, w / ar) if w / h > ar else (h * ar, h)
        if rw < minw:
            rw, rh = minw, minw / ar
        rw, rh = min(rw, limit_w), min(rh, limit_h)
        m = SAFE * rh / H
        y0 = (top + bottom) / 2 - rh / 2
        if top - y0 < m:
            y0 = top - m
        if y0 + rh < bottom:              # 여백을 두니 아래가 잘리면 상자를 키워 다시
            h = bottom - (top - m)
            y = top - m
            continue
        break
    x0 = min(max(0, x + w / 2 - rw / 2), limit_w - rw)
    y0 = min(max(0, y0), limit_h - rh)
    return (x0, y0, x0 + rw, y0 + rh)


ZONES = []
for z in zooms:
    t1 = z.get("t1", z["t0"] + 1.5)
    if z.get("pan"):
        if not z.get("still"):
            continue
        bx, by, bw, bh = z["box"]
        raw = still(z["still"])                # 소명 쪽만 2배로 찍은 이미지
        # 인쇄 배치에선 소명 쪽이 화면 왼쪽 끝에 붙어 있어 좌우 여백을 덧대고,
        # 위아래로 걸친 앞뒤 학생의 한 줄씩은 잘라 낸다
        PADX, TRIM = 56, 34
        top_pad = int(SAFE * (raw.width + PADX * 2) / W)   # 첫 화면에서 카드가 제목을 가리지 않게
        st = Image.new("RGB", (raw.width + PADX * 2, raw.height - TRIM * 2 + top_pad), (255, 255, 255))
        st.paste(raw.crop((0, TRIM, raw.width, raw.height - TRIM)), (PADX, top_pad))
        _stills[z["still"]] = st
        band = st.width * H / W                # 폭을 화면 폭에 맞춘 띠 높이
        # 확대가 끝나는 위치 = 여백을 덧댄 스틸의 첫 띠와 같은 자리 (화면 px). 다르면 넘어갈 때 튄다
        sx0 = bx - PADX / 2
        sy0 = by + (TRIM - top_pad) / 2
        vw = st.width / 2
        ZONES.append(dict(kind="pan", a=z["t0"], b=t1, still=z["still"],
                          start_vp=(sx0, sy0, sx0 + vw, sy0 + vw * H / W), band=band, travel=max(0.0, st.height - band)))
    else:
        x, y, w, h = z["box"]
        ZONES.append(dict(kind="zoom", a=z["t0"], b=t1, still=z.get("still"), rect=fit(x, y, w, h, W, H, W / ZMAX)))


def view_at(t):
    """(화면 이미지, 이 시각의 확대 영역(화면 px) 또는 None)"""
    for zn in ZONES:
        a, b = zn["a"], zn["b"]
        if zn["kind"] == "pan" and a - 0.01 <= t:
            # 화면 → 소명 쪽 폭으로 확대(녹화 프레임) → 2배 스틸에서 아래로 훑기
            k = ease((t - a) / ZIN)
            st = still(zn["still"])
            if k < 1:
                return cut(frame_at(t), lerp_rect(FULL, zn["start_vp"], k)), None
            span = max(0.1, (b - a) - ZIN - 0.8)
            top = zn["travel"] * ease((t - a - ZIN) / span)
            sharp = st.crop((0, round(top), st.width, round(top + zn["band"]))).resize((W, H), Image.LANCZOS)
            blend = (t - a - ZIN) / 0.2          # 녹화 프레임 → 2배 스틸을 0.2초에 걸쳐 교차
            if blend < 1:
                sharp = Image.blend(cut(frame_at(t), zn["start_vp"]), sharp, max(0.0, blend))
            return sharp, None
        if zn["kind"] == "zoom" and a - 0.01 <= t <= b + ZOUT:
            k = ease((t - a) / ZIN) if t < b else 1 - ease((t - b) / ZOUT)
            rect = lerp_rect(FULL, zn["rect"], k)
            img = cut(frame_at(t), rect)
            # 확대가 다 들어가 멈춰 있는 동안만 2배 스틸로 바꾼다 (0.15초에 걸쳐)
            if zn["still"] and a + ZIN <= t <= b:
                sk = max(0.0, min(1.0, (t - a - ZIN) / 0.15, (b - t) / 0.15))
                if sk > 0:
                    sharp = cut(still(zn["still"]), rect)
                    img = sharp if sk >= 1 else Image.blend(img, sharp, sk)
            return img, rect
    return frame_at(t), FULL


def cut(img, rect):
    """rect(화면 px)를 잘라 영상 크기로. 화면 밖은 흰색 (인쇄 화면 배경과 같다)"""
    s = img.width / W                 # 프레임은 1배, 스틸은 2배
    box = tuple(round(v * s) for v in rect)
    if box[0] < 0 or box[1] < 0 or box[2] > img.width or box[3] > img.height:
        canvas = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), (255, 255, 255))
        canvas.paste(img.crop((max(0, box[0]), max(0, box[1]), min(img.width, box[2]), min(img.height, box[3]))),
                     (max(0, -box[0]), max(0, -box[1])))
        return canvas.resize((W, H), Image.LANCZOS)
    return img.crop(box).resize((W, H), Image.LANCZOS)


# ── 포인터와 클릭 표시
def mouse_at(t):
    if t <= MOUSE[0]["t"]:
        return MOUSE[0]["x"], MOUSE[0]["y"]
    for p, q in zip(MOUSE, MOUSE[1:]):
        if p["t"] <= t < q["t"]:
            k = ease((t - p["t"]) / max(1e-3, q["t"] - p["t"]))
            return p["x"] + (q["x"] - p["x"]) * k, p["y"] + (q["y"] - p["y"]) * k
    return MOUSE[-1]["x"], MOUSE[-1]["y"]


S = 2  # 포인터는 2배로 그려 줄인다 (가장자리 매끈하게)
_arrow = Image.new("RGBA", (34 * S, 40 * S), (0, 0, 0, 0))
_d = ImageDraw.Draw(_arrow)
_pts = [(4, 3), (4, 31), (11, 24), (16, 36), (21, 34), (16, 22), (26, 22)]
_d.polygon([(x * S, y * S) for x, y in _pts], fill=(255, 255, 255, 255))
_d.polygon([(x * S, y * S) for x, y in [(6, 7), (6, 27), (11.5, 21.5), (16.5, 32.5), (18.5, 31.6), (13.6, 20.3), (21.5, 20.3)]], fill=(24, 27, 40, 255))
_arrow = _arrow.resize((34, 40), Image.LANCZOS)
_shadow = Image.new("RGBA", _arrow.size, (0, 0, 0, 0))
_shadow.paste((0, 0, 0, 90), (0, 0), _arrow)
_shadow = _shadow.filter(ImageFilter.GaussianBlur(2.2))


def draw_pointer(img, t, rect):
    if rect is None:
        return
    x0, y0, x1, y1 = rect
    sx = W / (x1 - x0)
    over = ImageDraw.Draw(img, "RGBA")
    for c in CLICKS:
        dt = t - c["t"]
        if 0 <= dt < 0.55:
            px, py = (c["x"] - x0) * sx, (c["y"] - y0) * sx
            r = 12 + 26 * ease(dt / 0.55)
            a = int(220 * (1 - dt / 0.55))
            over.ellipse((px - r, py - r, px + r, py + r), outline=BLUE + (a,), width=4)
    mx, my = mouse_at(t)
    px, py = (mx - x0) * sx, (my - y0) * sx
    img.paste(_shadow, (int(px - 3), int(py)), _shadow)
    img.paste(_arrow, (int(px - 4), int(py - 3)), _arrow)


# ── 장 제목: 화면 윗부분을 가로로 어둡게 깔고 그 위에 흰 글씨로 크게
# (배경 화면에 글자가 많아 흰 카드로는 제목이 묻혔다)
BAND_H, SOLID = 176, 112
_band = Image.new("RGBA", (W, BAND_H), (0, 0, 0, 0))
_bd = ImageDraw.Draw(_band)
for y in range(BAND_H):
    # 제목이 놓이는 위쪽은 진하게 덮고, 그 아래만 부드럽게 옅어진다
    a = 222 if y < SOLID else int(222 * (1 - ease((y - SOLID) / (BAND_H - SOLID))))
    _bd.line((0, y, W, y), fill=(20, 24, 42, a))


def card(n):
    layer = Image.new("RGBA", (W, BAND_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((44, 34, 98, 88), 12, fill=BLUE)
    d.text((71, 61), f"{n + 1:02d}", font=F_NUM, fill=(255, 255, 255), anchor="mm")
    shadow = Image.new("RGBA", (W, BAND_H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((120, 62), CAPTIONS[n], font=F_TITLE, fill=(0, 0, 0, 170), anchor="lm")
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(4)))
    d = ImageDraw.Draw(layer)
    d.text((120, 60), CAPTIONS[n], font=F_TITLE, fill=(255, 255, 255), anchor="lm")
    return layer


CARDS = [card(i) for i in range(len(CAPTIONS))]


def paste_card(img, n, t_in, t_left):
    """t_in: 장면 시작 후 지난 시간, t_left: 장면 끝까지 남은 시간"""
    first, last = n == 0, n == len(CAPTIONS) - 1
    # 띠는 장면이 바뀌어도 그대로 두고(깜박임 없이) 글자만 바꾼다
    kb = ease(t_in / CARD_IN) if first else 1.0
    band = _band if kb >= 1 else _band.copy()
    if kb < 1:
        band.putalpha(band.getchannel("A").point(lambda v: int(v * kb)))
    img.alpha_composite(band, (0, 0))
    k_in = ease(t_in / CARD_IN)
    k_out = 1.0 if last else ease(t_left / CARD_OUT)
    k = min(k_in, k_out)
    if k <= 0:
        return
    layer = CARDS[n]
    if k < 1:
        layer = layer.copy()
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * k)))
    img.alpha_composite(layer, (int(-40 * (1 - k_in)), 0))


NOTE_BAR = Image.new("RGBA", (W, 44), (255, 255, 255, 228))
ImageDraw.Draw(NOTE_BAR).text((W / 2, 22), NOTICE, font=F_NOTE, fill=DIM, anchor="mm")


def scene_of(t):
    for i in range(len(scenes)):
        if t < bounds[i + 1]:
            return i
    return len(scenes) - 1


def render(t):
    n = scene_of(t)
    rec = T0 + t
    img, rect = view_at(rec)
    img = img.copy() if img.mode == "RGB" else img.convert("RGB")
    draw_pointer(img, rec, rect)
    edge = bounds[n]
    if n > 0 and t - edge < FADE / 2:   # 장면 경계 디졸브
        prev, prect = view_at(T0 + edge - FADE / 2)
        prev = prev.copy()
        draw_pointer(prev, T0 + edge - FADE / 2, prect)
        img = Image.blend(prev, img, ease(0.5 + (t - edge) / FADE))
    img = img.convert("RGBA")
    paste_card(img, n, t - bounds[n], bounds[n + 1] - t)
    if t < NOTICE_SEC + 0.4:
        a = 1.0 if t < NOTICE_SEC else 1 - (t - NOTICE_SEC) / 0.4
        bar = NOTE_BAR if a >= 1 else NOTE_BAR.copy()
        if a < 1:
            bar.putalpha(bar.getchannel("A").point(lambda v: int(v * a)))
        img.paste(bar, (0, H - 44), bar)
    img = img.convert("RGB")
    edge_k = min(1.0, t / 0.3, (TOTAL - t) / 0.5)
    if edge_k < 1:
        img = Image.blend(Image.new("RGB", (W, H), BG), img, max(0.0, edge_k))
    return img


if __name__ == "__main__":
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    proc = subprocess.Popen([ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                             "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                             "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
                             "-movflags", "+faststart", "-an", str(OUT)], stdin=subprocess.PIPE)
    n_out = int(round(TOTAL * FPS))
    # 장면별 대표 PNG: 확대가 다 들어간 시점(없으면 장면 중간)
    picks = {}
    for i, s in enumerate(scenes):
        a, b = s["t0"], s["t1"]
        z = next((z for z in zooms if a <= z["t0"] < b), None)
        tt = (z["t0"] + ZIN + 0.6) if z else (a + b) / 2
        if z and z.get("pan"):
            tt = min(b, z["t0"] + ZIN + 2.5)
        picks[i] = tt - T0
    pick_frames = {int(round(v * FPS)): i for i, v in picks.items()}
    for k in range(n_out):
        img = render(k / FPS)
        proc.stdin.write(img.tobytes())
        if k in pick_frames:
            img.save(SRC / f"scene-{pick_frames[k] + 1:02d}.png")
        if k % 150 == 0:
            print(f"  {k / FPS:5.1f}s / {TOTAL:.1f}s", flush=True)
    proc.stdin.close()
    proc.wait()
    print(f"완료: {OUT} · {TOTAL:.1f}초 · {W}x{H} {FPS}fps · 프레임 {n_out}")

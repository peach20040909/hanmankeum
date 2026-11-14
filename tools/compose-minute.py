# 녹화 프레임 → 결선용 1분 시연 영상 (1920×1080, 30fps, 무음)
#   python -I tools/compose-minute.py            (입력 tools/out/minute)
# 레이아웃: 왼쪽 576px 자막 패널 + 오른쪽 실제 화면 1344×1008(원본 크기 그대로라 글자가 선명).
# 확대는 녹화 때 기록한 상자를 2배 해상도 프레임에서 잘라 키운다.
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

SRC = Path("tools/out/minute")
OUT = SRC / "hanmankeum-demo-60s.mp4"
W, H, FPS = 1920, 1080, 30
PANEL = 576
AX, AY = PANEL, 36                    # 실제 화면 위치
FADE = 0.4                            # 장면 전환
ZIN, ZOUT, ZMAX = 0.55, 0.45, 2.1     # 확대 들어가기·나오기(초), 최대 배율

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
# 줄바꿈 위치만 지정한다 (이어 붙이면 위 문구와 같아야 함 — 아래에서 검사)
CAPTION_LINES = [
    ["교수님이 확정한", "평가기준"],
    ["AI 분류 ≠ 규칙 판단", "→ 확인 필요"],
    ["AI 판단 · 규칙 판단 ·", "이유"],
    ["원본을 보고", "교수가 결정"],
    ["수정 전 판단도 보존"],
    ["온라인 기록 0%", "≠ 기여 0%"],
    ["자기 기술·동료 증언은", "수치와 분리"],
    ["기여율과 근거를 함께"],
]
for _c, _l in zip(CAPTIONS, CAPTION_LINES):
    assert " ".join(_l) == _c, (_c, _l)
NOTICE = "시연 팀: 실제 저장소 커밋·PR 사용 / 팀원 배정·분류·기여율은 설명용 예시"
NOTICE_SEC = 3.0

BD, RG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
F_LOGO, F_TAG = ImageFont.truetype(BD, 34), ImageFont.truetype(RG, 17)
F_NUM, F_CAP = ImageFont.truetype(BD, 22), ImageFont.truetype(BD, 46)
F_NOTE, F_FOOT = ImageFont.truetype(RG, 19), ImageFont.truetype(RG, 16)
# 서비스 색 그대로 (public/style.css: --bg #f5f5fa · --ink #262b3e · --muted #7b8091 · --blue #4b7cf3)
BG, INK, DIM, ACC, BAR, PANEL_BG = (245, 245, 250), (38, 43, 62), (123, 128, 145), (75, 124, 243), (220, 226, 242), (255, 255, 255)

tl = json.loads((SRC / "timeline.json").read_text(encoding="utf-8"))
VW, VH = tl["viewport"]
DSF = tl["dsf"]
frames = tl["frames"]
scenes = tl["scenes"]
zooms = tl["zooms"]
if len(scenes) != len(CAPTIONS):
    sys.exit(f"장면 수가 다릅니다: 녹화 {len(scenes)} / 자막 {len(CAPTIONS)}")

T0 = scenes[0]["t0"]
LAST_MAX = 8.0                         # 마지막 장면은 확대한 채로 8초에서 끝낸다 (전체 60±3초)
scenes[-1]["t1"] = min(scenes[-1]["t1"], scenes[-1]["t0"] + LAST_MAX)
TOTAL = scenes[-1]["t1"] - T0
bounds = [s["t0"] - T0 for s in scenes] + [TOTAL]

_probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def wrap(text, font, width):
    """어절 단위로, 두 줄이면 길이가 비슷하게 끊는다 (한 단어만 떨어지는 줄 방지)"""
    words = text.split(" ")
    if _probe.textlength(text, font) <= width:
        return [text]
    best = None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        wa, wb = _probe.textlength(a, font), _probe.textlength(b, font)
        if max(wa, wb) <= width and (best is None or max(wa, wb) < best[0]):
            best = (max(wa, wb), [a, b])
    if best:
        return best[1]
    lines, line = [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if _probe.textlength(trial, font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ── 프레임 로딩 (같은 프레임이 연달아 쓰이므로 하나만 기억)
_cache = {"i": None, "img": None}
src_times = [f["t"] for f in frames]


def frame_at(t):
    """녹화 시각 t 이전의 마지막 프레임 (화면이 안 바뀌면 프레임이 오지 않는다)"""
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


FULL = (0.0, 0.0, float(VW), float(VH))   # 모든 좌표는 CSS px


def target_rect(box):
    """상자를 4:3 화면 비율로 넓히고 최대 배율을 넘지 않게 맞춘다 (CSS px)"""
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    ar = VW / VH
    if w / h > ar:
        h = w / ar
    else:
        w = h * ar
    minw = VW / ZMAX
    if w < minw:
        w, h = minw, minw / ar
    w, h = min(w, VW), min(h, VH)
    x0 = min(max(0, cx - w / 2), VW - w)
    y0 = min(max(0, cy - h / 2), VH - h)
    return (x0, y0, x0 + w, y0 + h)


ZR = [(z["t0"], z.get("t1", z["t0"] + 1.5), target_rect(z["box"]), z.get("still")) for z in zooms]
_stills = {}


def still(name):
    if name not in _stills:
        _stills[name] = Image.open(SRC / name).convert("RGB")
    return _stills[name]


def zoom_at(t):
    """(확대 영역 CSS px, 스틸 이름, 스틸 섞는 비율)"""
    for a, b, rect, st in ZR:
        if a - 0.01 <= t <= b + ZOUT:
            k = ease((t - a) / ZIN) if t < b else 1 - ease((t - b) / ZOUT)
            # 확대가 다 들어간 뒤 멈춰 있는 동안만 2배 스틸을 쓴다 (0.15초에 걸쳐 바꿈)
            sk = 0.0
            if st and a + ZIN <= t <= b:
                sk = max(0.0, min(1.0, (t - a - ZIN) / 0.15, (b - t) / 0.15))
            return tuple(f + (r - f) * k for f, r in zip(FULL, rect)), st, sk
    return FULL, None, 0.0


def cut(img, rect):
    s = img.width / VW                # 프레임은 1배, 스틸은 2배
    return img.crop(tuple(round(v * s) for v in rect)).resize((VW, VH), Image.LANCZOS)


def app_view(t):
    rect, st, sk = zoom_at(t)
    view = cut(frame_at(t), rect)
    if sk > 0:
        view = Image.blend(view, cut(still(st), rect), sk) if sk < 1 else cut(still(st), rect)
    return view


# ── 고정 요소 (한 번만 그린다)
mask = Image.new("L", (VW, VH), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, VW - 1, VH - 1), 14, fill=255)
base = Image.new("RGB", (W, H), BG)
ImageDraw.Draw(base).rectangle((0, 0, PANEL - 1, H), fill=PANEL_BG)
ImageDraw.Draw(base).line((PANEL - 1, 0, PANEL - 1, H), fill=(236, 236, 243), width=1)
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((AX + 6, AY + 10, AX + VW + 6, AY + VH + 10), 16, fill=(61, 110, 240, 46))
base.paste(shadow.filter(ImageFilter.GaussianBlur(14)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
d = ImageDraw.Draw(base)
d.rounded_rectangle((64, 64, 104, 104), 11, fill=ACC)
d.text((84, 84), "한", font=ImageFont.truetype(BD, 22), fill=(255, 255, 255), anchor="mm")
d.text((120, 60), "한만큼", font=F_LOGO, fill=INK)
d.text((122, 104), "AI 리터러시 경진대회 · 결선 시연", font=F_TAG, fill=DIM)
d.text((64, H - 70), "hanmankeum.vercel.app", font=F_FOOT, fill=DIM)


def panel_text(n, alpha):
    """장면 번호와 자막 한 묶음을 투명도와 함께 그린다"""
    layer = Image.new("RGBA", (PANEL, H), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    a = int(255 * alpha)
    dl.text((64, 380), f"{n + 1:02d} / {len(CAPTIONS):02d}", font=F_NUM, fill=ACC + (a,))
    y = 424
    for line in CAPTION_LINES[n]:
        dl.text((64, y), line, font=F_CAP, fill=INK + (a,))
        y += 64
    return layer


def progress(n, frac):
    layer = Image.new("RGBA", (PANEL, 8), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer)
    seg = (PANEL - 128 - 7 * 8) / 8
    for i in range(8):
        x = 64 + i * (seg + 8)
        dl.rounded_rectangle((x, 0, x + seg, 6), 3, fill=BAR)
        fill = 1 if i < n else (frac if i == n else 0)
        if fill > 0:
            dl.rounded_rectangle((x, 0, x + seg * fill, 6), 3, fill=ACC)
    return layer


def scene_of(t):
    for i in range(len(scenes)):
        if t < bounds[i + 1]:
            return i
    return len(scenes) - 1


def render(t):
    """출력 시각 t(0~TOTAL)의 한 장"""
    img = base.copy()
    n = scene_of(t)
    rec = T0 + t
    view = app_view(rec)
    # 장면 경계 앞뒤 FADE/2 동안 화면을 겹쳐 녹인다
    edge = bounds[n]
    if n > 0 and t - edge < FADE / 2:
        k = 0.5 + (t - edge) / FADE
        view = Image.blend(app_view(T0 + edge - FADE / 2), view, ease(k))
    img.paste(view, (AX, AY), mask)
    # 자막도 경계에서 교차
    into = t - bounds[n]
    if n > 0 and into < FADE:
        img.paste(panel_text(n - 1, 1 - ease(into / FADE)), (0, 0), panel_text(n - 1, 1 - ease(into / FADE)))
        layer = panel_text(n, ease(into / FADE))
    else:
        layer = panel_text(n, 1.0)
    img.paste(layer, (0, 0), layer)
    pr = progress(n, (t - bounds[n]) / (bounds[n + 1] - bounds[n]))
    img.paste(pr, (0, 640), pr)
    # 첫 3초 고지 — 화면 아래 고정
    if t < NOTICE_SEC + 0.4:
        a = 1.0 if t < NOTICE_SEC else 1 - (t - NOTICE_SEC) / 0.4
        layer = Image.new("RGBA", (W, 36), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((AX + VW / 2, 18), NOTICE, font=F_NOTE, fill=DIM + (int(255 * a),), anchor="mm")
        img.paste(layer, (0, H - 36), layer)
    # 시작·끝 페이드
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
    # 장면별 대표 PNG: 확대가 끝까지 들어간 시점(없으면 장면 중간)
    picks = {}
    for i, s in enumerate(scenes):
        a, b = s["t0"], s["t1"]
        z = next((z for z in zooms if a <= z["t0"] < b), None)
        picks[i] = (z["t0"] + ZIN + 0.4 - T0) if z else ((a + b) / 2 - T0)
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

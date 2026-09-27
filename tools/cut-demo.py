# 녹화 프레임 → 발표용 시연 영상 (왼쪽 3 : 오른쪽 7 분할, 핵심 구간만 잘라서)
# 사용: python tools/cut-demo.py <녹화폴더> <출력폴더> [short|core|full]
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

REC, OUTDIR = Path(sys.argv[1]), Path(sys.argv[2])
ONLY = sys.argv[3] if len(sys.argv) > 3 else None
S = 1.5                                        # 720p 기준 좌표 × S = 1080p
W, H, PANEL, FPS = 1920, 1080, 576, 30         # 3 : 7 분할
APP_W, APP_H, APP_Y = 1344, 1008, 36           # 녹화 원본 크기 그대로 (업스케일 없음)
px = lambda v: int(v * S)
BG, INK, DIM, ACC, LINE = (13, 17, 38), (255, 255, 255), (134, 143, 173), (91, 140, 255), (34, 41, 74)

STEPS = [  # (키, 단계명, 설명)
    ("invite",  "팀 초대 · 도구 연결", "교수가 팀을 만들고 팀원에게 개인 초대 링크를 보냅니다."),
    ("weights", "MRL 가중치 잠금",    "만들기 · 다듬기 · 이끌기 비중을 정하고, 결과를 모르는 지금 잠급니다."),
    ("collect", "기록 수집 · 자동 분류", "학기 중에는 알림도 점수도 없습니다. 기록이 3축으로 분류됩니다."),
    ("peer",    "익명 동료평가",      "기록에 없는 기여는 마감 후 익명 증언으로 보완합니다."),
    ("report",  "기여도 리포트",      "마감 후 1회 산출. 판정하지 않고 산식과 근거를 전달합니다."),
]
KEYS = [s[0] for s in STEPS]

# 버전별 구간: (단계, 녹화 시작초, 길이초)
VERSIONS = {
    "short": ("한만큼_시연_15초.mp4", False, [
        ("weights", 21.6, 2.7), ("collect", 30.8, 2.7), ("peer", 39.8, 3.3), ("report", 49.8, 2.8), ("report", 59.0, 3.5),
    ]),
    "core": ("한만큼_시연_40초.mp4", True, [
        ("invite", 1.8, 2.8), ("weights", 8.0, 4.8), ("weights", 21.0, 4.0),
        ("collect", 25.4, 3.0), ("collect", 30.4, 3.6),
        ("peer", 37.6, 6.8), ("report", 49.0, 5.0), ("report", 58.0, 5.8),
    ]),
    "full": ("한만큼_시연_전체.mp4", True, [(k, None, None) for k in KEYS]),
}

BD, RG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
F_LOGO, F_SUB = ImageFont.truetype(BD, px(25)), ImageFont.truetype(RG, px(12))
F_NUM, F_STEP, F_STEP_ON = ImageFont.truetype(BD, px(13)), ImageFont.truetype(RG, px(15)), ImageFont.truetype(BD, px(16))
F_TITLE, F_CAP = ImageFont.truetype(BD, px(25)), ImageFont.truetype(RG, px(14))
_probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))

tl = json.loads((REC / "timeline.json").read_text(encoding="utf-8"))
starts = {s["name"]: s["t"] for s in tl["steps"]}
frames, DUR = tl["frames"], tl["duration"]
span = {k: (starts[k], starts[KEYS[i + 1]] if i + 1 < len(KEYS) else DUR) for i, k in enumerate(KEYS)}


def wrap(text, font, width):
    out, line = [], ""
    for word in text.split(" "):
        trial = f"{line} {word}".strip()
        if _probe.textlength(trial, font) <= width or not line:
            line = trial
        else:
            out.append(line)
            line = word
    out.append(line)
    return out


def panel(step_i, progress):
    img = Image.new("RGB", (PANEL, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((px(40), px(40), px(74), px(74)), px(10), fill=ACC)
    d.text((px(57), px(57)), "ㅎ", font=F_LOGO, fill=INK, anchor="mm")
    d.text((px(88), px(45)), "한만큼", font=F_LOGO, fill=INK)
    d.text((px(90), px(76)), "각자가 한 만큼", font=F_SUB, fill=DIM)
    y = px(150)
    for i, (_, title, _) in enumerate(STEPS):
        on = i == step_i
        if on:
            d.rounded_rectangle((px(28), y - px(14), PANEL - px(28), y + px(34)), px(12), fill=(22, 29, 62))
            d.rounded_rectangle((px(28), y - px(14), px(32), y + px(34)), px(2), fill=ACC)
        d.ellipse((px(48), y - px(2), px(68), y + px(18)), fill=ACC if on else (30, 37, 68))
        d.text((px(58), y + px(8)), str(i + 1), font=F_NUM, fill=INK if on else DIM, anchor="mm")
        d.text((px(84), y + px(8)), title, font=F_STEP_ON if on else F_STEP, fill=INK if on else DIM, anchor="lm")
        y += px(66)
    title, desc = STEPS[step_i][1], STEPS[step_i][2]
    lines = wrap(desc, F_CAP, PANEL - px(80))
    y = H - px(72) - len(lines) * px(26)
    d.line((px(40), y - px(56), PANEL - px(40), y - px(56)), fill=LINE)
    d.text((px(40), y - px(36)), title, font=F_TITLE, fill=INK)
    for line in lines:
        d.text((px(40), y + px(6)), line, font=F_CAP, fill=(191, 201, 226))
        y += px(26)
    d.rectangle((0, H - px(4), int(PANEL * progress), H), fill=ACC)
    return img


def cover(title, sub):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((W / 2 - 32, H / 2 - 142, W / 2 + 32, H / 2 - 78), 18, fill=ACC)
    d.text((W / 2, H / 2 - 110), "ㅎ", font=ImageFont.truetype(BD, 40), fill=INK, anchor="mm")
    d.text((W / 2, H / 2 - 24), title, font=ImageFont.truetype(BD, 42), fill=INK, anchor="mm")
    for i, line in enumerate(sub.split("\n")):
        d.text((W / 2, H / 2 + 42 + i * 32), line, font=ImageFont.truetype(RG, 19), fill=(176, 187, 216), anchor="mm")
    return img


def render(name, covers, cuts):
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = OUTDIR / name
    p = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "slower", "-crf", "16", "-pix_fmt", "yuv420p", "-x264-params", "ref=5:bframes=5:aq-mode=3", "-movflags", "+faststart", str(out)],
                         stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    n_written = 0

    def push(img, n=1):
        nonlocal n_written
        b = img.tobytes()
        for _ in range(n):
            p.stdin.write(b)
            n_written += 1

    def fade(img, n):
        black = Image.new("RGB", img.size, (8, 10, 24))
        for i in range(n):
            push(Image.blend(black, img, (i + 1) / n))

    # 전체 길이(진행 막대용)
    total = sum((span[k][1] - span[k][0]) if d is None else d for k, _, d in cuts)
    done = 0.0
    cache = {}
    if covers:
        c = cover("한만큼", "협업툴 기록을 모아, 팀 기여를 근거와 함께.\n지금 실제로 돌아가는 화면입니다.")
        fade(c, int(0.4 * FPS)); push(c, int(1.8 * FPS))
    prev = None
    for k, t0, dur in cuts:
        i = KEYS.index(k)
        t0 = span[k][0] if t0 is None else t0
        dur = (span[k][1] - span[k][0]) if dur is None else dur
        j = 0
        for f in range(int(dur * FPS)):
            t = t0 + f / FPS
            while j + 1 < len(frames) and frames[j + 1]["t"] <= t:
                j += 1
            idx = frames[j]["i"]
            if idx not in cache:
                cache.clear()
                cache[idx] = Image.open(REC / f"f{idx:06d}.png").convert("RGB")
            img = Image.new("RGB", (W, H), BG)
            img.paste(panel(i, (done + f / FPS) / total), (0, 0))
            img.paste(cache[idx], (PANEL, APP_Y))
            if prev is not None and f < int(0.24 * FPS):  # 구간 전환은 짧게 겹침
                img = Image.blend(prev, img, (f + 1) / int(0.24 * FPS))
            push(img)
            last = img
        prev = last
        done += dur
    if covers:
        c = cover("판정하지 않고, 근거를 제공합니다", "본 리포트는 성적을 산출하지 않습니다.\n최종 평가는 교수님의 판단에 따릅니다.")
        fade(c, int(0.4 * FPS)); push(c, int(2.0 * FPS))
    p.stdin.close(); p.wait()
    print(f"{out.name}  {n_written / FPS:.1f}s  {out.stat().st_size / 1e6:.1f}MB")


OUTDIR.mkdir(parents=True, exist_ok=True)
for key, (name, covers, cuts) in VERSIONS.items():
    if ONLY and key != ONLY:
        continue
    render(name, covers, cuts)

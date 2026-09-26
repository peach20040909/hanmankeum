# 녹화 프레임 + 상단 워크플로우 바 → 시연 영상
# 사용: python tools/compose-demo.py <녹화폴더> <출력.mp4> [배속]
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

REC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
SPEED = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
W, H, BAR, FPS = 1280, 720, 56, 30
VH = H - BAR

STEPS = [("consent", "1. 개인정보 동의"), ("weights", "2. 가중치 잠금"), ("collect", "3. 기록 수집"),
         ("peer", "4. 익명 동료평가"), ("report", "5. 기여도 리포트")]

BD, RG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
F_ON, F_OFF, F_SEP, F_LOGO = ImageFont.truetype(BD, 19), ImageFont.truetype(RG, 18), ImageFont.truetype(RG, 16), ImageFont.truetype(BD, 17)
BG, ON, OFF, SEP, ACC = (14, 18, 40), (255, 255, 255), (129, 138, 165), (58, 66, 98), (108, 152, 255)

tl = json.loads((REC / "timeline.json").read_text(encoding="utf-8"))
starts = {s["name"]: s["t"] for s in tl["steps"]}


def active(t):
    cur = 0
    for i, (key, _) in enumerate(STEPS):
        if key in starts and t >= starts[key]:
            cur = i
    return cur


def bar(t):
    img = Image.new("RGB", (W, BAR), BG)
    d = ImageDraw.Draw(img)
    cur = active(t)
    labels = [lbl for _, lbl in STEPS]
    widths = [d.textlength(l, F_ON if i == cur else F_OFF) for i, l in enumerate(labels)]
    gap, sep_w = 30, d.textlength("›", F_SEP)
    total = sum(widths) + (len(labels) - 1) * (gap * 2 + sep_w)
    x = (W - total) / 2
    for i, l in enumerate(labels):
        f, color = (F_ON, ON) if i == cur else (F_OFF, OFF)
        d.text((x, BAR / 2), l, font=f, fill=color, anchor="lm")
        if i == cur:  # 현재 단계 밑줄
            d.rounded_rectangle((x, BAR - 8, x + widths[i], BAR - 5), 2, fill=ACC)
        x += widths[i]
        if i < len(labels) - 1:
            x += gap
            d.text((x, BAR / 2 - 1), "›", font=F_SEP, fill=SEP, anchor="lm")
            x += sep_w + gap
    d.text((28, BAR / 2), "한만큼", font=F_LOGO, fill=(226, 232, 255), anchor="lm")
    return img


frames = tl["frames"]
dur = tl["duration"] / SPEED
n_out = int(dur * FPS)
ff = imageio_ffmpeg.get_ffmpeg_exe()
OUT.parent.mkdir(parents=True, exist_ok=True)
p = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

cache, j = {}, 0
for k in range(n_out):
    t = k / FPS * SPEED
    while j + 1 < len(frames) and frames[j + 1]["t"] <= t:
        j += 1
    idx = frames[j]["i"]
    if idx not in cache:
        cache.clear()
        cache[idx] = Image.open(REC / f"f{idx:06d}.jpg").convert("RGB").resize((W, VH), Image.LANCZOS)
    out = Image.new("RGB", (W, H))
    out.paste(bar(t), (0, 0))
    out.paste(cache[idx], (0, BAR))
    p.stdin.write(out.tobytes())
p.stdin.close()
p.wait()
print(f"{OUT}  {n_out/FPS:.1f}s  {OUT.stat().st_size/1e6:.1f}MB")

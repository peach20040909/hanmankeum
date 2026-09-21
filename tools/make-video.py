# 캡처한 화면 → 발표 6페이지용 시연 클립(약 13초, 무음)
# 사용: python tools/make-video.py <프레임폴더> <출력.mp4>
import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
W, H, FPS = 1280, 720, 30
HOLD, FADE = 1.55, 0.3  # 컷당 유지 시간 / 교차 전환

SHOTS = [
    ("01-consent.png",    "STEP 01  착수", "팀 전원이 동의해야 시작합니다"),
    ("02-weights.png",    "STEP 01  착수", "교수가 4축 가중치를 정합니다"),
    ("03-locked.png",     "STEP 01  착수", "결과를 모르는 시점에 기준을 잠급니다"),
    ("04-quiet.png",      "STEP 02  수집", "학기 중에는 알림도 점수도 없습니다"),
    ("05-classified.png", "STEP 03  분류", "기록을 생성·개선·조율·소통 4축으로"),
    ("06-report.png",     "STEP 04  리포트", "마감 후 팀 내 기여율을 한 번 산출"),
    ("07-detail.png",     "STEP 04  리포트", "산식과 근거 기록까지 그대로"),
    ("08-testimony.png",  "STEP 04  리포트", "판정하지 않고 근거를 제공합니다"),
]

F_STEP = ImageFont.truetype("C:/Windows/Fonts/malgunbd.ttf", 22)
F_CAP = ImageFont.truetype("C:/Windows/Fonts/malgunbd.ttf", 30)


def frame(img, step, cap, zoom):
    """가운데 기준 살짝 줌 + 하단 자막"""
    cw, ch = int(img.width / zoom), int(img.height / zoom)
    x, y = (img.width - cw) // 2, int((img.height - ch) * 0.35)
    out = img.crop((x, y, x + cw, y + ch)).resize((W, H), Image.LANCZOS).convert("RGB")
    d = ImageDraw.Draw(out, "RGBA")
    tw = max(d.textlength(step, F_STEP), d.textlength(cap, F_CAP))
    box = (40, H - 132, 40 + int(tw) + 56, H - 36)
    d.rounded_rectangle(box, 16, fill=(24, 30, 58, 232))
    d.text((box[0] + 28, box[1] + 18), step, font=F_STEP, fill=(126, 167, 255, 255))
    d.text((box[0] + 28, box[1] + 48), cap, font=F_CAP, fill=(255, 255, 255, 255))
    return out


def shot_frames(name, step, cap, n):
    img = Image.open(SRC / name)
    return [frame(img, step, cap, 1.035 - 0.035 * (i / max(n - 1, 1))) for i in range(n)]


hold_n, fade_n = int(HOLD * FPS), int(FADE * FPS)
clips = [shot_frames(*s, hold_n) for s in SHOTS]

frames = list(clips[0])
for nxt in clips[1:]:  # 앞 컷의 꼬리와 다음 컷의 머리를 겹쳐 교차 전환
    tail, head = frames[-fade_n:], nxt[:fade_n]
    frames[-fade_n:] = [Image.blend(tail[i], head[i], (i + 1) / fade_n) for i in range(fade_n)]
    frames.extend(nxt[fade_n:])

ff = imageio_ffmpeg.get_ffmpeg_exe()
OUT.parent.mkdir(parents=True, exist_ok=True)
p = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for f in frames:
    p.stdin.write(f.tobytes())
p.stdin.close()
p.wait()

# PowerPoint 대비 GIF도 함께 (12fps, 절반 크기)
gif = OUT.with_suffix(".gif")
subprocess.run([ff, "-y", "-i", str(OUT), "-vf", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
                "-loop", "0", str(gif)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"{OUT}  {len(frames)/FPS:.1f}s  {OUT.stat().st_size/1e6:.1f}MB")
print(f"{gif}  {gif.stat().st_size/1e6:.1f}MB")

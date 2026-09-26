# 캡처한 화면 → 발표 6페이지용 시연 클립(약 15초, 무음)
# 사용: python tools/make-video.py <프레임폴더> <출력.mp4>
import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
W, H, FPS = 1280, 720, 30
HOLD, FADE = 2.66, 0.5  # 컷당 유지 시간 / 교차 전환 (겹침)

SHOTS = [
    ("01-consent.png",    "STEP 01 · 착수", "팀 전원이 동의해야 수집을 시작합니다"),
    ("02-weights.png",    "STEP 01 · 착수", "교수가 4축 가중치를 정하고 기준을 잠급니다"),
    ("04-quiet.png",      "STEP 02 · 수집", "학기 중에는 알림도 점수도 없습니다"),
    ("06-classified.png", "STEP 03 · 분류", "기록을 생성 · 개선 · 조율 · 소통 4축으로 분류합니다"),
    ("05-peer.png",       "마감 후 · 보완", "로그에 없는 기여는 익명 동료평가로 받습니다"),
    ("07-report.png",     "STEP 04 · 리포트", "마감 후 팀 내 기여율을 한 번 산출합니다"),
    ("08-detail.png",     "STEP 04 · 리포트", "판정하지 않고, 산식과 근거를 그대로 전달합니다"),
]

BD, RG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
F_STEP = ImageFont.truetype(RG, 21)
F_CAP = ImageFont.truetype(BD, 33)
INK, ACCENT = (255, 255, 255), (169, 198, 255)
BAND, FADE_TOP = 196, 86  # 하단 자막 영역 / 위쪽으로 흐려지는 구간

# 위 86px만 부드럽게 흐려지고 아래는 짙은 네이비 (자막 대비 확보)
_band = Image.new("RGBA", (1, BAND))
for y in range(BAND):
    a = 246 * (y / FADE_TOP) ** 1.5 if y < FADE_TOP else 246
    _band.putpixel((0, y), (16, 21, 44, int(a)))
BAND_IMG = _band.resize((W, BAND), Image.BILINEAR)


def frame(img, step, cap, progress):
    out = img.resize((W, H), Image.LANCZOS).convert("RGBA")
    out.alpha_composite(BAND_IMG, (0, H - BAND))
    d = ImageDraw.Draw(out)
    x, y = 72, H - 104
    d.text((x, y), " ".join(step), font=F_STEP, fill=ACCENT)   # 자간 넓힌 라벨
    d.text((x, y + 32), cap, font=F_CAP, fill=INK)
    d.rectangle((0, H - 4, int(W * progress), H), fill=(75, 124, 243))  # 하단 진행선
    return out.convert("RGB")


hold_n, fade_n = int(HOLD * FPS), int(FADE * FPS)
total = len(SHOTS) * hold_n - (len(SHOTS) - 1) * fade_n
done = 0
clips = []
for name, step, cap in SHOTS:
    img = Image.open(SRC / name)
    clips.append([frame(img, step, cap, min((done + i) / total, 1)) for i in range(hold_n)])
    done += hold_n - fade_n

frames = list(clips[0])
for nxt in clips[1:]:  # 앞 컷의 꼬리와 다음 컷의 머리를 부드럽게 겹침
    tail, head = frames[-fade_n:], nxt[:fade_n]
    frames[-fade_n:] = [Image.blend(tail[i], head[i], (lambda p: p * p * (3 - 2 * p))((i + 1) / fade_n)) for i in range(fade_n)]
    frames.extend(nxt[fade_n:])

ff = imageio_ffmpeg.get_ffmpeg_exe()
OUT.parent.mkdir(parents=True, exist_ok=True)
p = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                      "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for f in frames:
    p.stdin.write(f.tobytes())
p.stdin.close()
p.wait()

# HTML 슬라이드용 GIF
gif = OUT.with_suffix(".gif")
subprocess.run([ff, "-y", "-i", str(OUT), "-vf", "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
                "-loop", "0", str(gif)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"{OUT}  {len(frames)/FPS:.1f}s  {OUT.stat().st_size/1e6:.1f}MB")
print(f"{gif}  {gif.stat().st_size/1e6:.1f}MB")

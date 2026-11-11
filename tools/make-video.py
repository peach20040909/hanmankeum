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
    ("03_교수기준입력.png", "STEP 01 · 교수 기준", "교수님이 원래 쓰던 평가기준을 붙여 넣습니다"),
    ("04_기준정리초안.png", "STEP 02 · 정리 초안", "AI 정리 초안을 교수가 확인하고 수정합니다"),
    ("06_학생확인_기준잠금.png", "STEP 03 · 기준 잠금", "교수 확정 · 학생 확인을 거쳐 기준을 잠급니다"),
    ("07_기록수집_자동분류.png", "STEP 04 · 기록 분류", "작업 기록을 교수님 기준 항목으로 분류합니다"),
    ("08_확인필요.png", "STEP 05 · 교차 확인", "AI와 규칙의 판단이 다르면 원본을 확인합니다"),
    ("10_기여도리포트.png", "STEP 06 · 리포트", "마감 후 최초 산출하고 검토에 따라 정정합니다"),
    ("12_원본기록_확인.png", "STEP 06 · 근거", "판정하지 않고, 산식과 근거를 전달합니다"),
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

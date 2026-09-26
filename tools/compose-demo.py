# 녹화 프레임 → 발표용 시연 영상 (단계 카드 + 왼쪽 단계 패널 + 오른쪽 실제 화면)
# 사용: python tools/compose-demo.py <녹화폴더> <출력.mp4>
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

REC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
W, H, PANEL, FPS = 1280, 720, 320, 30
APP_W = W - PANEL
CARD, FADE = 2.6, 0.45  # 단계 카드 시간 / 페이드

STEPS = [
    ("invite",  "팀 초대 · 도구 연결", "교수가 팀을 만들고 팀원에게 개인 초대 링크를 보냅니다.\n협업툴의 편집 기록만 연결합니다."),
    ("weights", "MRL 가중치 잠금",    "만들기 · 다듬기 · 이끌기 비중을 교수가 정하고,\n결과를 모르는 지금 시점에 기준을 잠급니다."),
    ("collect", "학기 중 기록 수집",  "학생 화면에는 알림도 점수도 없습니다.\n협업툴 기록만 조용히 쌓이고 3축으로 분류됩니다."),
    ("peer",    "익명 동료평가",      "기록에 남지 않은 기여는 마감 후 익명 증언으로 보완합니다.\n점수를 매기지 않고, 무엇을 했는지만 적습니다."),
    ("report",  "기여도 리포트",      "마감 후 한 번만 산출합니다.\n판정하지 않고 산식과 근거를 그대로 전달합니다."),
]

BD, RG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
F_LOGO, F_SUB = ImageFont.truetype(BD, 26), ImageFont.truetype(RG, 13)
F_NUM, F_STEP, F_STEP_ON = ImageFont.truetype(BD, 13), ImageFont.truetype(RG, 15), ImageFont.truetype(BD, 16)
F_CAP = ImageFont.truetype(RG, 14)
F_CARD_NUM, F_CARD_TITLE, F_CARD_DESC = ImageFont.truetype(BD, 20), ImageFont.truetype(BD, 44), ImageFont.truetype(RG, 20)
BG, INK, DIM, ACC, LINE = (13, 17, 38), (255, 255, 255), (134, 143, 173), (91, 140, 255), (34, 41, 74)

tl = json.loads((REC / "timeline.json").read_text(encoding="utf-8"))
starts = {s["name"]: s["t"] for s in tl["steps"]}
frames = tl["frames"]
DUR = tl["duration"]
# 각 단계의 녹화 구간
spans = []
for i, (key, title, desc) in enumerate(STEPS):
    t0 = starts[key]
    t1 = starts[STEPS[i + 1][0]] if i + 1 < len(STEPS) else DUR
    spans.append((t0, t1))


_probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))


def wrap(text, font, width):
    """어절 단위 줄바꿈 (문단은 \n 유지)"""
    out = []
    for para in text.split("\n"):
        line = ""
        for word in para.split(" "):
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
    d.rounded_rectangle((36, 40, 70, 74), 10, fill=ACC)
    d.text((48, 57), "ㅎ", font=F_LOGO, fill=INK, anchor="mm")
    d.text((84, 48), "한만큼", font=F_LOGO, fill=INK)
    d.text((86, 80), "각자가 한 만큼", font=F_SUB, fill=DIM)
    y = 150
    for i, (_, title, desc) in enumerate(STEPS):
        on = i == step_i
        if on:
            d.rounded_rectangle((26, y - 16, PANEL - 26, y + 34), 12, fill=(22, 29, 62))
            d.rounded_rectangle((26, y - 16, 30, y + 34), 2, fill=ACC)
        d.ellipse((44, y - 2, 64, y + 18), fill=ACC if on else (30, 37, 68))
        d.text((54, y + 8), str(i + 1), font=F_NUM, fill=INK if on else DIM, anchor="mm")
        d.text((78, y + 8), title, font=F_STEP_ON if on else F_STEP, fill=INK if on else DIM, anchor="lm")
        y += 68
    # 현재 단계 설명
    lines = wrap(STEPS[step_i][2], F_CAP, PANEL - 72)
    y = H - 60 - len(lines) * 26
    d.line((36, y - 26, PANEL - 36, y - 26), fill=LINE)
    for line in lines:
        d.text((36, y), line, font=F_CAP, fill=(191, 201, 226))
        y += 26
    d.rectangle((0, H - 4, int(PANEL * progress), H), fill=ACC)
    return img


def card(step_i):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    key, title, desc = STEPS[step_i]
    d.text((W / 2, H / 2 - 92), f"STEP 0{step_i + 1}", font=F_CARD_NUM, fill=ACC, anchor="mm")
    d.text((W / 2, H / 2 - 32), title, font=F_CARD_TITLE, fill=INK, anchor="mm")
    y = H / 2 + 34
    for line in desc.split("\n"):
        d.text((W / 2, y), line, font=F_CARD_DESC, fill=(176, 187, 216), anchor="mm")
        y += 34
    return img


def intro(title, sub):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((W / 2 - 34, H / 2 - 150, W / 2 + 34, H / 2 - 82), 20, fill=ACC)
    d.text((W / 2, H / 2 - 116), "ㅎ", font=ImageFont.truetype(BD, 44), fill=INK, anchor="mm")
    d.text((W / 2, H / 2 - 30), title, font=F_CARD_TITLE, fill=INK, anchor="mm")
    for i, line in enumerate(sub.split("\n")):
        d.text((W / 2, H / 2 + 40 + i * 34), line, font=F_CARD_DESC, fill=(176, 187, 216), anchor="mm")
    return img


ff = imageio_ffmpeg.get_ffmpeg_exe()
OUT.parent.mkdir(parents=True, exist_ok=True)
p = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)],
                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
written = 0


def push(img, n=1):
    global written
    b = img.tobytes()
    for _ in range(n):
        p.stdin.write(b)
        written += 1


def fade_in(img, n):  # 검정에서 서서히
    black = Image.new("RGB", img.size, (8, 10, 24))
    for i in range(n):
        push(Image.blend(black, img, (i + 1) / n))


# 인트로
intro_img = intro("한만큼", "협업툴 기록을 모아, 팀 기여를 근거와 함께.\n지금 실제로 돌아가는 화면입니다.")
fade_in(intro_img, int(0.5 * FPS))
push(intro_img, int(2.3 * FPS))

cache = {}
for i, (t0, t1) in enumerate(spans):
    c = card(i)
    fade_in(c, int(FADE * FPS))
    push(c, int(CARD * FPS))
    n = int((t1 - t0) * FPS)
    j = 0
    for k in range(n):
        t = t0 + k / FPS
        while j + 1 < len(frames) and frames[j + 1]["t"] <= t:
            j += 1
        idx = frames[j]["i"]
        if idx not in cache:
            cache.clear()
            cache[idx] = Image.open(REC / f"f{idx:06d}.jpg").convert("RGB").resize((APP_W, H), Image.LANCZOS)
        out = Image.new("RGB", (W, H))
        out.paste(panel(i, (k + 1) / n), (0, 0))
        out.paste(cache[idx], (PANEL, 0))
        push(out)

# 아웃트로
out_img = intro("판정하지 않고, 근거를 제공합니다", "본 리포트는 성적을 산출하지 않습니다.\n최종 평가는 교수님의 판단에 따릅니다.")
fade_in(out_img, int(0.5 * FPS))
push(out_img, int(2.4 * FPS))

p.stdin.close()
p.wait()
print(f"{OUT}  {written / FPS:.1f}s  {OUT.stat().st_size / 1e6:.1f}MB")

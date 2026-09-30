# 시연 영상·캡처가 함께 쓰는 왼쪽 단계 패널
from PIL import Image, ImageDraw, ImageFont

BD, RG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
BG, INK, DIM, ACC, LINE = (13, 17, 38), (255, 255, 255), (134, 143, 173), (91, 140, 255), (34, 41, 74)
STEPS = [  # (키, 단계명, 설명)
    ("invite",  "팀 초대 · 도구 연결", "교수가 팀을 만들고 팀원에게 개인 초대 링크를 보냅니다."),
    ("weights", "MRL 가중치 잠금",    "만들기 · 다듬기 · 이끌기 비중을 정하고, 결과를 모르는 지금 잠급니다."),
    ("collect", "기록 수집 · 자동 분류", "학기 중에는 알림도 점수도 없습니다. 기록이 3축으로 분류됩니다."),
    ("peer",    "익명 동료평가",      "기록에 없는 기여는 마감 후 익명 증언으로 보완합니다."),
    ("report",  "기여도 리포트",      "마감 후 1회 산출. 판정하지 않고 산식과 근거를 전달합니다."),
]
KEYS = [s[0] for s in STEPS]
_probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))


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


def logo_mark(img, x, y, size):
    """앱 로고와 같은 마크: 라운드 사각형 + 높이가 다른 막대 3개"""
    ss = 4  # 안티에일리어싱용 확대 배율
    m = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    md = ImageDraw.Draw(m)
    u = size * ss / 32  # 32 단위 좌표계
    md.rounded_rectangle((0, 0, size * ss - 1, size * ss - 1), int(9 * u), fill=(61, 110, 240, 255))
    for bx, by, alpha in ((7.5, 17, 150), (13.9, 12, 205), (20.3, 7, 255)):
        md.rounded_rectangle((bx * u, by * u, (bx + 4.2) * u, 25 * u), int(2.1 * u), fill=(255, 255, 255, alpha))
    mark = m.resize((size, size), Image.LANCZOS)
    img.paste(mark, (x, y), mark)


def make_panel(step_i, progress, S, width, height):
    """S: 720p 기준 좌표 배율"""
    px = lambda v: int(v * S)
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    f_logo, f_sub = ImageFont.truetype(BD, px(25)), ImageFont.truetype(RG, px(12))
    f_num, f_step, f_on = ImageFont.truetype(BD, px(13)), ImageFont.truetype(RG, px(15)), ImageFont.truetype(BD, px(16))
    f_title, f_cap = ImageFont.truetype(BD, px(25)), ImageFont.truetype(RG, px(14))
    logo_mark(img, px(40), px(40), px(36))
    d.text((px(92), px(43)), "한만큼", font=f_logo, fill=INK)
    d.text((px(94), px(74)), "각자가 한 만큼", font=f_sub, fill=DIM)
    y = px(150)
    for i, (_, title, _) in enumerate(STEPS):
        on = i == step_i
        if on:
            d.rounded_rectangle((px(28), y - px(14), width - px(28), y + px(34)), px(12), fill=(22, 29, 62))
            d.rounded_rectangle((px(28), y - px(14), px(32), y + px(34)), px(2), fill=ACC)
        d.ellipse((px(48), y - px(2), px(68), y + px(18)), fill=ACC if on else (30, 37, 68))
        d.text((px(58), y + px(8)), str(i + 1), font=f_num, fill=INK if on else DIM, anchor="mm")
        d.text((px(84), y + px(8)), title, font=f_on if on else f_step, fill=INK if on else DIM, anchor="lm")
        y += px(66)
    title, desc = STEPS[step_i][1], STEPS[step_i][2]
    lines = wrap(desc, f_cap, width - px(80))
    y = height - px(72) - len(lines) * px(26)
    d.line((px(40), y - px(56), width - px(40), y - px(56)), fill=LINE)
    d.text((px(40), y - px(36)), title, font=f_title, fill=INK)
    for line in lines:
        d.text((px(40), y + px(6)), line, font=f_cap, fill=(191, 201, 226))
        y += px(26)
    d.rectangle((0, height - px(4), int(width * progress), height), fill=ACC)
    return img

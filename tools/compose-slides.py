# 캡처 PNG + 왼쪽 단계 패널 → PPT 삽입용 4K 스틸 (영상과 같은 3:7 구성)
# 사용: python tools/compose-slides.py <캡처폴더> <출력폴더>
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from panel import make_panel

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
S = 3                                   # 720p 기준 × 3 = 3840x2160
W, H, PANEL = 1280 * S, 720 * S, 384 * S
APP_W, APP_H, APP_Y = 2688, 2016, 72    # 캡처 원본 크기 그대로

# 캡처 파일 → (단계 인덱스, 대본 구간)
SHOTS = [
    ("01_팀초대", 0), ("02_도구연결", 0),
    ("03_가중치설정", 1), ("04_학생확인_기준잠금", 1),
    ("05_학기중_학생화면", 2), ("06_기록수집_자동분류", 2),
    ("07_익명동료평가", 3),
    ("08_기여도리포트", 4), ("09_산출근거_상세", 4), ("10_원본기록_확인", 4),
]

OUT.mkdir(parents=True, exist_ok=True)
for n, (name, step) in enumerate(SHOTS, 1):
    app = Image.open(SRC / f"{name}.png").convert("RGB")
    if app.size != (APP_W, APP_H):
        app = app.resize((APP_W, APP_H), Image.LANCZOS)
    img = Image.new("RGB", (W, H), (13, 17, 38))
    img.paste(make_panel(step, (n) / len(SHOTS), S, PANEL, H), (0, 0))
    img.paste(app, (PANEL, APP_Y))
    img.save(OUT / f"{name}.png")
    print("·", name, img.size)

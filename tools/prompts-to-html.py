"""docs/prompts.md → 제출용 PDF 용 HTML.

제출물 「프롬프트」는 이 스크립트로 문서에서 그대로 생성한다. 손으로 옮겨 적지 않는다.

    python -I tools/prompts-to-html.py docs/prompts.md out/prompts.html
    # 브라우저에서 out/prompts.html 을 열고 A4 · 배경 그래픽 켜고 PDF 로 인쇄

markdown 라이브러리를 쓰지 않는다. 이 문서에 실제로 쓰인 문법(제목·표·코드블록·
인용·목록·수평선·굵게·인라인 코드·링크)만 다루면 충분하고, 의존성을 늘리지 않는 쪽이 낫다.
"""
import io, re, html, sys

SRC, OUT = sys.argv[1], sys.argv[2]
lines = io.open(SRC, encoding='utf-8').read().split('\n')


def inline(t, escape=True):
    if escape:
        t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    return t


out, i = [], 0
while i < len(lines):
    l = lines[i]

    if l.startswith('```'):                                   # 코드 블록
        i += 1
        buf = []
        while i < len(lines) and not lines[i].startswith('```'):
            buf.append(lines[i]); i += 1
        i += 1
        out.append('<pre>' + html.escape('\n'.join(buf)) + '</pre>')
        continue

    if l.startswith('|'):                                     # 표
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            rows.append(lines[i]); i += 1
        cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
        body = cells[1:]
        if len(cells) > 1 and all(set(c) <= set('-: ') for c in cells[1]):
            body = cells[2:]
        head = ''.join(f'<th>{inline(c)}</th>' for c in cells[0])
        trs = ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in body)
        out.append(f'<table><thead><tr>{head}</tr></thead><tbody>{trs}</tbody></table>')
        continue

    if l.startswith('> '):                                    # 인용
        buf = []
        while i < len(lines) and lines[i].startswith('> '):
            buf.append(lines[i][2:]); i += 1
        out.append('<blockquote>' + inline(' '.join(buf)) + '</blockquote>')
        continue

    if l.startswith('- '):                                    # 불릿
        buf = []
        while i < len(lines) and lines[i].startswith('- '):
            buf.append(lines[i][2:]); i += 1
        out.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in buf) + '</ul>')
        continue

    if re.match(r'^\d+\. ', l):                               # 번호 목록
        buf = []
        while i < len(lines) and re.match(r'^\d+\. ', lines[i]):
            buf.append(re.sub(r'^\d+\. ', '', lines[i])); i += 1
        out.append('<ol>' + ''.join(f'<li>{inline(x)}</li>' for x in buf) + '</ol>')
        continue

    if l.strip() == '---':
        out.append('<hr>'); i += 1; continue

    m = re.match(r'^(#{1,4}) (.*)$', l)
    if m:
        n = len(m.group(1))
        out.append(f'<h{n}>{inline(m.group(2))}</h{n}>'); i += 1; continue

    if l.strip():                                             # 문단 (줄바꿈 유지)
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||> |- |\d+\. |```|---$)', lines[i]):
            buf.append(lines[i]); i += 1
        out.append('<p>' + '<br>'.join(inline(x) for x in buf) + '</p>')
        continue

    i += 1

CSS = """
@page{size:A4;margin:17mm 16mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;color:#1e2434;
 font-size:10pt;line-height:1.78;letter-spacing:-.02em;word-break:keep-all;overflow-wrap:break-word;
 -webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4,p{margin:0}
h1{font-size:30pt;letter-spacing:-.045em;line-height:1.2;margin:0 0 6mm}
h2{font-size:17pt;letter-spacing:-.035em;margin:11mm 0 4mm;padding-top:4mm;border-top:1.5px solid #1e2434;
 break-after:avoid}
h3{font-size:11.5pt;margin:7mm 0 2.5mm;letter-spacing:-.03em;break-after:avoid}
h4{font-size:10.5pt;margin:5mm 0 2mm;break-after:avoid}
p{margin-bottom:3.5mm}
strong{font-weight:650}
a{color:#1e2434;border-bottom:.6px solid #c0563a;text-decoration:none}
hr{border:0;height:0;margin:0}
code{font-family:Consolas,"D2Coding",monospace;font-size:8.8pt;background:#f1f2f7;padding:.6mm 1.4mm;
 border-radius:2px;word-break:normal;overflow-wrap:anywhere;white-space:nowrap}
td code,th code{white-space:normal}
pre{font-family:Consolas,"D2Coding",monospace;font-size:8.6pt;line-height:1.7;background:#f7f8fc;
 border-left:2.5px solid #c0563a;padding:4mm 5mm;margin:4mm 0;white-space:pre-wrap;word-break:normal;
 overflow-wrap:anywhere;break-inside:avoid}
table{width:100%;border-collapse:collapse;font-size:9pt;margin:4mm 0}
th{text-align:left;padding:2.4mm 3mm;background:#f4f5f9;color:#4b5467;font-weight:600;font-size:8.4pt;
 border-bottom:1.2px solid #d8dce6}
td{padding:2.8mm 3mm;border-bottom:1px solid #eceef4;vertical-align:top}
table{table-layout:auto}
th:first-child,td:first-child{min-width:33mm}
tr{break-inside:avoid}
/* 표가 쪽을 넘길 때 머리글을 다시 찍는다 — 통째로 미뤄 큰 여백을 만드는 것보다 낫다 */
thead{display:table-header-group;break-after:avoid}
blockquote{margin:5mm 0;padding:4mm 5mm;background:#f7f8fc;border-left:3px solid #c0563a;font-size:10pt;
 break-inside:avoid}
ul,ol{margin:3mm 0;padding-left:5.5mm}
li{margin-bottom:1.8mm}
.cover{height:238mm;display:flex;flex-direction:column;justify-content:center;break-after:page}
.cover .eyebrow{font-family:Consolas,monospace;font-size:9pt;letter-spacing:.14em;color:#8b93a6}
.cover .sub{font-size:13pt;color:#4b5467;margin-top:6mm;line-height:1.7;max-width:140mm}
.cover .meta{margin-top:auto;padding-top:10mm;border-top:1.5px solid #1e2434;display:flex;
 justify-content:space-between;font-size:9.5pt;color:#6b7385}
.cover .meta strong{color:#1e2434;font-weight:600}
body>h2:first-of-type{border-top:0;padding-top:0;margin-top:0}
"""

doc = '\n'.join(out)
# 원문 첫 h1 과 바로 뒤 두 줄을 표지로 들어낸다
doc = re.sub(r'^<h1>.*?</h1>\s*<p>.*?</p>', '', doc, count=1, flags=re.S)

COVER = """<section class="cover">
  <p class="eyebrow">2026 MJU AI LITERACY CONTEST · 제출물 3 — 프롬프트</p>
  <h1 style="font-size:40pt;margin-top:12mm">프롬프트 문서</h1>
  <p class="sub">한만큼이 생성형 AI를 어디에 어떻게 쓰는지,<br>그 결과를 무엇으로 검증하는지 적은 문서.<br>여기 적힌 프롬프트는 배포본에서 실제로 돌아가는 문자열 그대로입니다.</p>
  <div class="meta"><div>팀 <strong>HMK</strong> · 박서준 · 김효준 · 장민준</div><div><strong>2026. 11.</strong></div></div>
</section>"""

io.open(OUT, 'w', encoding='utf-8').write(
    f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    f'<title>한만큼 프롬프트 문서</title><style>{CSS}</style></head><body>{COVER}{doc}</body></html>')
print('ok', OUT)

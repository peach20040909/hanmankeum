// Chromium/Skia가 생성한 PDF만 검사한다. 일반 PDF 파서가 아니며 새 패키지를 요구하지 않는다.
// 페이지별 실제 텍스트를 읽어 쪽수뿐 아니라 꼬리 문구 고립·빈 페이지도 검증한다.
import { inflateSync } from 'node:zlib';
export function chromiumPDF(buffer) {
  const objects = new Map([...buffer.toString('latin1').matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map(m => [m[1], m[2]]));
  const stream = id => {
    const obj = objects.get(id);
    if (!obj) throw new Error(`PDF object ${id} missing`);
    const bytes = obj.match(/stream\r?\n/);
    if (!bytes) throw new Error(`PDF stream ${id} missing`);
    const length = Number(obj.match(/\/Length (\d+)/)?.[1]);
    const data = Buffer.from(obj.slice(bytes.index + bytes[0].length, bytes.index + bytes[0].length + length), 'latin1');
    return (/\/FlateDecode/.test(obj) ? inflateSync(data) : data).toString('latin1');
  };
  const unicode = hex => Buffer.from(hex, 'hex').swap16().toString('utf16le');
  const fonts = new Map();
  for (const [id, obj] of objects) {
    const ref = obj.match(/\/ToUnicode (\d+) 0 R/);
    if (!ref) continue;
    const cmap = stream(ref[1]), map = new Map();
    for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) map.set(m[1].toUpperCase(), unicode(m[2]));
    }
    for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
        const start = parseInt(m[1], 16), end = parseInt(m[2], 16), target = parseInt(m[3], 16);
        for (let code = start; code <= end; code++) map.set(code.toString(16).toUpperCase().padStart(m[1].length, '0'), String.fromCodePoint(target + code - start));
      }
    }
    fonts.set(id, { map, width: Number(cmap.match(/begincodespacerange\s*<([\da-f]+)>/i)?.[1].length) });
  }
  const pages = [];
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(obj)) continue;
    const refs = new Map([...obj.matchAll(/\/(F\d+) (\d+) 0 R/g)].map(m => [m[1], m[2]]));
    const contents = obj.match(/\/Contents (\d+) 0 R/);
    if (!contents) throw new Error('Unsupported Chromium PDF contents');
    const data = stream(contents[1]);
    let font, text = '';
    const baselines = new Set();
    for (const m of data.matchAll(/\/(F\d+) [\d.]+ Tf|<([\da-f]+)> Tj|1 0 0 -1 [\d.-]+ ([\d.-]+) Tm/gi)) {
      if (m[1]) font = fonts.get(refs.get(m[1]));
      else if (m[3]) baselines.add(m[3]);
      else {
        if (!font?.width) throw new Error('Unsupported Chromium PDF font');
        for (let i = 0; i < m[2].length; i += font.width) {
          const value = font.map.get(m[2].slice(i, i + font.width).toUpperCase());
          if (value == null) throw new Error('Unknown Chromium PDF glyph');
          text += value;
        }
      }
    }
    pages.push({ text, lines: baselines.size });
  }
  if (!pages.length) throw new Error('No Chromium PDF pages');
  return pages;
}

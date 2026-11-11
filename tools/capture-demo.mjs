// 영상용 정지 캡처도 동일한 교수 기준 흐름을 실행한다.
// node tools/capture-demo.mjs [출력폴더]
process.argv[2] ||= 'tools/out/capture';
await import('./capture-slides.mjs');

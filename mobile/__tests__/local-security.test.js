/** @jest-environment node */
const { assertAnalysisBudget, assertLocalVideoUri } = require('../modules/pose-tracker/src/local-media');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const manifest = require('../modules/pose-tracker/web-assets.json');

describe('fronteira de mídia local', () => {
  it.each(['https://example.com/video.mp4','http://localhost/file.mp4','data:video/mp4;base64,AA==','file:///tmp/video.mp4','blob:https://example.com/id','blob:http://localhost.evil/id','/video.mp4',''])('bloqueia a URI Web %s', uri => {
    expect(() => assertLocalVideoUri(uri, 'web', 'http://localhost')).toThrow('local');
  });
  it('aceita somente Blob do mesmo documento e arquivos locais nativos', () => {
    expect(() => assertLocalVideoUri('blob:http://localhost/id', 'web', 'http://localhost')).not.toThrow();
    expect(() => assertLocalVideoUri('file:///tmp/video.mp4', 'native')).not.toThrow();
    expect(() => assertLocalVideoUri('content://media/local-video', 'native')).not.toThrow();
  });
  it.each(['https://example.com/video.mp4','http://localhost/video','file://remote-server/share/video.mp4','ftp://server/video','/tmp/video'])('bloqueia URI nativa remota/ambígua %s', uri => {
    expect(() => assertLocalVideoUri(uri, 'native')).toThrow('local');
  });
  it('limita a memória por amostras e rejeita duração infinita/inválida', () => {
    expect(() => assertAnalysisBudget(599, 8)).not.toThrow();
    for (const duration of [600, Infinity, NaN, -1, 0]) expect(() => assertAnalysisBudget(duration, 8)).toThrow();
  });
});
describe('cadeia de integridade dos recursos offline', () => {
  it.each(manifest.files)('confere bytes de $path contra a origem fixada', asset => {
    for (const file of [asset.source, 'public/mediapipe/' + asset.path]) {
      const bytes = readFileSync(resolve(__dirname, '..', file));
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    }
  });
  it('não permite retorno ao CDN nos pontos de carregamento', () => {
    const loader = readFileSync(resolve(__dirname, '../modules/pose-tracker/src/PoseTrackerModule.web.ts'), 'utf8');
    expect(loader).not.toMatch(/https?:\/\//);
    expect(loader).toContain('script.integrity = VISION_SDK_INTEGRITY');
    const sdk = readFileSync(resolve(__dirname, '../node_modules/@mediapipe/tasks-vision/vision_bundle.js'));
    expect(loader).toContain('sha256-' + createHash('sha256').update(sdk).digest('base64'));
  });
});

describe('compatibilidade das correções de dependências', () => {
  it('preserva parse/stringify de query-string e tolera escapes inválidos', () => {
    const query = require('query-string');
    expect(query.parse('ok=1&bad=%E0%A4%A')).toEqual({ok:'1',bad:'%E0%A4%A'});
    expect(query.parse(query.stringify({nome:'ação',reps:5}))).toEqual({nome:'ação',reps:'5'});
    expect(typeof require('decode-uri-component')).toBe('function');
  });
  it('mantém a API UUID v4 usada pelo gerador iOS', () => {
    const project = require('xcode').project('test'); project.hash={project:{objects:{}}};
    expect(project.generateUuid()).toMatch(/^[A-F0-9]{24}$/);
  });
});

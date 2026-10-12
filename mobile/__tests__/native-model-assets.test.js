/** @jest-environment node */
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const manifest = require('../modules/pose-tracker/model-assets.json');

describe.each(['android/src/main/assets', 'ios/assets'])('modelos empacotados em %s', (directory) => {
  it.each(Object.entries(manifest))('inclui %s completo e com o mesmo conteúdo oficial versionado', (_model, asset) => {
    const file = readFileSync(resolve(__dirname, '../modules/pose-tracker', directory, asset.file));
    expect(file.length).toBe(asset.bytes);
    expect(createHash('sha256').update(file).digest('hex')).toBe(asset.sha256);
  });
});

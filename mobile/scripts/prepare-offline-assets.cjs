const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('../modules/pose-tracker/web-assets.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function prepareOfflineAssets() {
  for (const asset of manifest.files) {
    const source = path.join(root, asset.source);
    const bytes = fs.readFileSync(source);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) {
      throw new Error('Integridade do recurso local divergente: ' + asset.source);
    }
    const target = path.join(root, 'public/mediapipe', asset.path);
    if (fs.existsSync(target) && hash(fs.readFileSync(target)) === asset.sha256) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}
module.exports = { prepareOfflineAssets };
if (require.main === module) { prepareOfflineAssets(); console.log('SDK, WASM e modelos locais verificados.'); }

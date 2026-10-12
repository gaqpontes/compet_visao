const {spawnSync} = require('node:child_process');
const path = require('node:path');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const result = spawnSync(process.execPath, [cli,...process.argv.slice(2)], {
  stdio:'inherit', env:{...process.env,EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1'}
});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;

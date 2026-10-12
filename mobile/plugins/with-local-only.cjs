const { withAndroidManifest } = require('@expo/config-plugins');
module.exports = function withLocalOnly(config) {
  return withAndroidManifest(config, config => {
    const app = config.modResults.manifest.application[0];
    app.$['android:usesCleartextTraffic'] = 'false';
    app.$['android:allowBackup'] = 'false';
    return config;
  });
};

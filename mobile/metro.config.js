const { getDefaultConfig } = require('expo/metro-config');
require('./scripts/prepare-offline-assets.cjs').prepareOfflineAssets();
module.exports = getDefaultConfig(__dirname);

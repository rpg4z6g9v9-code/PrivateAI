const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow .gguf model files to be resolved as assets (for local bundling if needed)
config.resolver.assetExts.push('gguf');

module.exports = config;

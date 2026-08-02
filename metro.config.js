const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow .gguf model files to be resolved as assets (for local bundling if needed)
config.resolver.assetExts.push('gguf');

// Third-party UMD builds (pdf.js, three.js) bundled as raw-text assets (not
// RN source) for local WebView injection — .jslib avoids Metro parsing them
// as app JS.
config.resolver.assetExts.push('jslib');

module.exports = config;

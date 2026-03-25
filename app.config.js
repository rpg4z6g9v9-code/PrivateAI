const appJson = require('./app.json');

const IS_PRODUCTION = process.env.APP_VARIANT === 'production';

module.exports = {
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    claudeApiKey: process.env.EXPO_PUBLIC_CLAUDE_API_KEY,
    elevenLabsApiKey: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY,
    tavilyApiKey: process.env.EXPO_PUBLIC_TAVILY_API_KEY,
    appVariant: process.env.APP_VARIANT ?? 'development',
  },
  plugins: [
    ...(appJson.expo.plugins ?? []),
    [
      'llama.rn',
      {
        // Enable entitlements for production (needed for Keychain, Face ID, app groups)
        enableEntitlements: IS_PRODUCTION,
        forceCxx20: true,
        enableOpenCL: false,
      },
    ],
    'expo-sqlite',
    'expo-local-authentication',
  ],
};

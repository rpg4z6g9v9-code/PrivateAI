const IS_PRODUCTION = process.env.APP_VARIANT === 'production';

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    claudeApiKey: process.env.EXPO_PUBLIC_CLAUDE_API_KEY,
    elevenLabsApiKey: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY,
    tavilyApiKey: process.env.EXPO_PUBLIC_TAVILY_API_KEY,
    appVariant: process.env.APP_VARIANT ?? 'development',
  },
  plugins: [
    ...(config.plugins ?? []),
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
});

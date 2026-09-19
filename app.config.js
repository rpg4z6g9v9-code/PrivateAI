const IS_PRODUCTION = process.env.APP_VARIANT === 'production';

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
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

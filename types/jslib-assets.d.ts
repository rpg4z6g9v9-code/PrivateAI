// Ambient module declaration for third-party UMD builds (pdf.js, three.js)
// bundled as raw-text Metro assets (see metro.config.js `jslib` assetExt).
// Mirrors RN's built-in asset require() contract (e.g. *.png) — resolves to
// a numeric module id that expo-asset's Asset.fromModule() consumes at runtime.
declare module '*.jslib' {
  const assetId: number;
  export default assetId;
}

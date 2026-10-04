// Mock: expo-file-system/legacy
export const cacheDirectory = '/tmp/mock-cache/';
export const documentDirectory = '/tmp/mock-docs/';

export async function getInfoAsync(uri) {
  return { exists: false, size: 0, isDirectory: false };
}
export async function deleteAsync(uri, options) {}
export function createDownloadResumable(url, dest, options, cb) {
  return { downloadAsync: async () => ({ uri: dest }) };
}

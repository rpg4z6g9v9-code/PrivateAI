// Module resolution hooks for M0 test harness.
// Handles: @/ path alias, React Native module mocking, .ts extension resolution.

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HOOKS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HOOKS_DIR, '../..');
const MOCKS_DIR = path.join(HOOKS_DIR, 'mocks');

// Native/RN modules that must be replaced with test doubles.
const NATIVE_MOCKS = new Map([
  ['react-native-encrypted-storage', 'encrypted-storage.mjs'],
  ['@react-native-async-storage/async-storage', 'async-storage.mjs'],
  ['expo-sqlite', 'expo-sqlite.mjs'],
  ['expo-local-authentication', 'expo-local-auth.mjs'],
  ['expo-file-system/legacy', 'expo-fs-legacy.mjs'],
  ['llama.rn', 'llama-rn.mjs'],
  ['expo-device', 'expo-device.mjs'],
]);

// Production modules that are type-only (all exports are interfaces/types).
// Redirect to value-exporting shims so named imports resolve at runtime.
const TYPE_ONLY_REDIRECTS = new Map([
  ['@/services/claude', 'claude-types.mjs'],
]);

function tryResolveFile(basePath) {
  // Try with common extensions
  for (const ext of ['', '.ts', '.tsx', '.js', '.mjs']) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  // Try as directory with index
  for (const ext of ['.ts', '.js', '.mjs']) {
    const candidate = path.join(basePath, 'index' + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  // 1. Native module mocks
  const mockFile = NATIVE_MOCKS.get(specifier);
  if (mockFile) {
    return {
      url: pathToFileURL(path.join(MOCKS_DIR, mockFile)).href,
      shortCircuit: true,
      format: 'module',
    };
  }

  // 2. Type-only module redirects
  const typeRedirect = TYPE_ONLY_REDIRECTS.get(specifier);
  if (typeRedirect) {
    return {
      url: pathToFileURL(path.join(MOCKS_DIR, typeRedirect)).href,
      shortCircuit: true,
      format: 'module',
    };
  }

  // 3. @/ path alias resolution
  if (specifier.startsWith('@/')) {
    const relative = specifier.slice(2);
    const basePath = path.join(PROJECT_ROOT, relative);
    const resolved = tryResolveFile(basePath);
    if (resolved) {
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    // Fall through to default resolution (will likely fail, but gives a clear error)
  }

  // 4. Relative .ts imports (e.g., './toolTypes' from personaPrompts.ts)
  //    Node with --experimental-transform-types may not add .ts automatically
  //    when importing from another .ts file.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (context.parentURL && !path.extname(specifier)) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const basePath = path.resolve(parentDir, specifier);
      const resolved = tryResolveFile(basePath);
      if (resolved) {
        return nextResolve(pathToFileURL(resolved).href, context);
      }
    }
  }

  return nextResolve(specifier, context);
}

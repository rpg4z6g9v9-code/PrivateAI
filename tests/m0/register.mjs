// M0 test harness — module loader registration.
// Registers custom hooks for @/ path resolution and RN module mocking.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);

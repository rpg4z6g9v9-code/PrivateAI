// Mock: llama.rn
export async function initLlama(opts) {
  return { completion: async () => ({ text: '' }) };
}
export async function releaseAllLlama() {}

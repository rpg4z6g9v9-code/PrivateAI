export const PROVIDER_GATEWAY_BASE = (
  process.env.EXPO_PUBLIC_PROVIDER_GATEWAY_URL ?? 'http://127.0.0.1:8787'
).replace(/\/+$/, '');

export type ProviderGatewayHealth = {
  ok: boolean;
  bind?: string;
  port?: number;
  providers?: {
    claude?: boolean;
    elevenlabs?: boolean;
  };
};

export function providerGatewayUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${PROVIDER_GATEWAY_BASE}${normalized}`;
}

export async function getProviderGatewayHealth(
  timeoutMs = 5000
): Promise<ProviderGatewayHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(providerGatewayUrl('/health'), {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkProviderGateway(
  timeoutMs = 5000
): Promise<boolean> {
  const health = await getProviderGatewayHealth(timeoutMs);
  return health?.ok === true;
}

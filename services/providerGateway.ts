import secureStorage from './secureStorage';

const DEFAULT_PROVIDER_GATEWAY_BASE = 'http://127.0.0.1:8787';

const PROVIDER_GATEWAY_BASE_KEY = 'providerGatewayBase_v1';
const PROVIDER_GATEWAY_TOKEN_KEY = 'providerGatewayToken_v1';

export type ProviderGatewayHealth = {
  ok: boolean;
  bind?: string;
  port?: number;
  providers?: {
    claude?: boolean;
    elevenlabs?: boolean;
  };
};

function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function getProviderGatewayBase(): Promise<string> {
  const stored = await secureStorage.getItem(PROVIDER_GATEWAY_BASE_KEY);

  if (stored?.trim()) {
    return normalizeBase(stored);
  }

  return DEFAULT_PROVIDER_GATEWAY_BASE;
}

export async function setProviderGatewayBase(value: string): Promise<void> {
  const normalized = normalizeBase(value);

  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('Gateway URL must begin with http:// or https://');
  }

  await secureStorage.setItem(
    PROVIDER_GATEWAY_BASE_KEY,
    normalized
  );
}

export async function clearProviderGatewayBase(): Promise<void> {
  await secureStorage.removeItem(PROVIDER_GATEWAY_BASE_KEY);
}

export async function getProviderGatewayToken(): Promise<string> {
  return (
    await secureStorage.getItem(PROVIDER_GATEWAY_TOKEN_KEY)
  )?.trim() ?? '';
}

export async function setProviderGatewayToken(
  token: string
): Promise<void> {
  const trimmed = token.trim();

  if (!trimmed) {
    await secureStorage.removeItem(PROVIDER_GATEWAY_TOKEN_KEY);
    return;
  }

  await secureStorage.setItem(
    PROVIDER_GATEWAY_TOKEN_KEY,
    trimmed
  );
}

export async function clearProviderGatewayToken(): Promise<void> {
  await secureStorage.removeItem(PROVIDER_GATEWAY_TOKEN_KEY);
}

export async function providerGatewayUrl(
  path: string
): Promise<string> {
  const base = await getProviderGatewayBase();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  return `${base}${normalized}`;
}

export async function providerGatewayFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const [url, token] = await Promise.all([
    providerGatewayUrl(path),
    getProviderGatewayToken(),
  ]);

  const headers = new Headers(init.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    ...init,
    headers,
  });
}

export async function getProviderGatewayHealth(
  timeoutMs = 5000
): Promise<ProviderGatewayHealth | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await providerGatewayFetch('/health', {
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

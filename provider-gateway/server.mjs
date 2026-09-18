import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PROVIDER_GATEWAY_PORT || 8787);

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  });
  res.end(data);
}

function sendUpstream(res, upstream, body) {
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'application/json',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > 1_000_000) {
      throw new Error('request_too_large');
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid_json');
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleClaude(req, res) {
  if (!CLAUDE_API_KEY) {
    return sendJson(res, 503, {
      error: 'claude_not_configured',
    });
  }

  const body = await readJson(req);

  if (!Array.isArray(body.messages)) {
    return sendJson(res, 400, {
      error: 'messages_required',
    });
  }

  const maxTokens = Math.max(
    1,
    Math.min(Number(body.max_tokens) || 1024, 4096)
  );

  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: typeof body.system === 'string' ? body.system : '',
    messages: body.messages,
  };

  const upstream = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    }
  );

  const text = await upstream.text();
  sendUpstream(res, upstream, text);
}

async function handleSearch(req, res) {
  if (!TAVILY_API_KEY) {
    return sendJson(res, 503, {
      error: 'tavily_not_configured',
    });
  }

  const body = await readJson(req);

  if (typeof body.query !== 'string' || !body.query.trim()) {
    return sendJson(res, 400, {
      error: 'query_required',
    });
  }

  const query = body.query.trim().slice(0, 2000);

  const upstream = await fetchWithTimeout(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    }
  );

  const text = await upstream.text();
  sendUpstream(res, upstream, text);
}

async function handleVoices(res) {
  if (!ELEVENLABS_API_KEY) {
    return sendJson(res, 503, {
      error: 'elevenlabs_not_configured',
    });
  }

  const upstream = await fetchWithTimeout(
    'https://api.elevenlabs.io/v1/voices',
    {
      method: 'GET',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
    }
  );

  const text = await upstream.text();
  sendUpstream(res, upstream, text);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || `${HOST}:${PORT}`}`
    );

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        bind: HOST,
        port: PORT,
        providers: {
          claude: Boolean(CLAUDE_API_KEY),
          tavily: Boolean(TAVILY_API_KEY),
          elevenlabs: Boolean(ELEVENLABS_API_KEY),
        },
      });
    }

    if (req.method === 'POST' && url.pathname === '/claude') {
      return await handleClaude(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/search') {
      return await handleSearch(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/elevenlabs/voices') {
      return await handleVoices(res);
    }

    return sendJson(res, 404, {
      error: 'not_found',
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'gateway_error';

    if (message === 'invalid_json') {
      return sendJson(res, 400, { error: message });
    }

    if (message === 'request_too_large') {
      return sendJson(res, 413, { error: message });
    }

    if (message === 'This operation was aborted') {
      return sendJson(res, 504, { error: 'upstream_timeout' });
    }

    console.error('[Gateway] request failed:', message);

    return sendJson(res, 502, {
      error: 'gateway_request_failed',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[Gateway] listening on http://${HOST}:${PORT}`);
  console.log(
    `[Gateway] providers: Claude=${Boolean(CLAUDE_API_KEY)} Tavily=${Boolean(TAVILY_API_KEY)} ElevenLabs=${Boolean(ELEVENLABS_API_KEY)}`
  );
});

process.on('SIGINT', () => {
  console.log('\n[Gateway] stopping');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

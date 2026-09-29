const ALLOWED_ORIGINS = new Set(['https://builtbysai.com']);
const TURN_TTL_SECONDS = 4 * 60 * 60;

function allowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      ...headers,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'atelier-turn-credentials' });
    }

    if (url.pathname !== '/ice') {
      return json({ error: 'not_found' }, 404);
    }

    const origin = request.headers.get('Origin') || '';
    if (!allowedOrigin(origin)) {
      return json({ error: 'origin_not_allowed' }, 403);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors(origin));
    }

    if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) {
      return json({ error: 'turn_not_configured' }, 503, cors(origin));
    }

    const endpoint =
      'https://rtc.live.cloudflare.com/v1/turn/keys/' +
      encodeURIComponent(env.CF_TURN_KEY_ID) +
      '/credentials/generate-ice-servers';

    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.CF_TURN_API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      });
    } catch (error) {
      return json({ error: 'turn_upstream_unreachable' }, 502, cors(origin));
    }

    if (!upstream.ok) {
      return json({ error: 'turn_upstream_failed' }, 502, cors(origin));
    }

    const payload = await upstream.json();
    if (!payload || !Array.isArray(payload.iceServers) || !payload.iceServers.length) {
      return json({ error: 'turn_upstream_invalid' }, 502, cors(origin));
    }

    return json({ iceServers: payload.iceServers }, 201, cors(origin));
  },
};

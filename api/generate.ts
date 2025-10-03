// api/generate.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// If you want to be explicit that this is Node.js (not edge), you can leave this line out;
// Node is the default for /api files.
// export const config = { runtime: 'nodejs' };

const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL || 'gpt-4'; // optional override

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[generate] start', { method: req.method });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
    console.error('[generate] missing env', {
      FUELIX_API_BASE: !!FUELIX_API_BASE,
      FUELIX_API_KEY: !!FUELIX_API_KEY,
    });
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Vercel’s Node runtime parses JSON automatically for application/json
  const { personas, base } = (req.body ?? {}) as {
    personas?: Array<{ name: string; description: string }>;
    base?: { channel?: string; subject?: string; message?: string; brief?: string };
  };

  // Minimal validation
  if (!Array.isArray(personas) || !base) {
    return res.status(400).json({ error: 'Invalid body: expected { personas: [], base: {} }' });
  }

  // Prepare prompt
  const system = `You are a marketing copy assistant. Output ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional", "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}
If channel != "email", omit the "subjects". Keep strings concise.`;

  const user = `Personas: ${JSON.stringify(personas)}
Base: ${JSON.stringify(base)}`;

  // 9s upstream timeout so we never hit the platform’s hard limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const r = await fetch(`${FUELIX_API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FUELIX_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: FUELIX_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        stream: false, // force non-streaming
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[generate] Fuel iX error', r.status, detail.slice(0, 500));
      return res.status(502).json({ error: 'Fuel iX call failed', status: r.status });
    }

    // Handle either JSON or text (in case the provider still streams-as-text)
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await r.text();
      try {
        return res.status(200).json(JSON.parse(text));
      } catch {
        return res.status(200).json({ raw: text });
      }
    }

    // OpenAI-compatible response
    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content ?? '';

    // Try to parse model content as JSON with our expected shape
    try {
      const parsed = JSON.parse(content);
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({ raw: content });
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      console.warn('[generate] upstream timed out');
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    console.error('[generate] unexpected error', err);
    return res.status(500).json({ error: 'server_error' });
  }
}

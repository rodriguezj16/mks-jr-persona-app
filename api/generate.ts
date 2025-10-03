// api/generate.ts
export const runtime = "nodejs";
export const maxDuration = 10; // ask Vercel to keep this function short

const FUELIX_API_BASE = process.env.FUELIX_API_BASE; // e.g. https://api.fuelix.ai
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4";

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  console.log("[generate] start", { method: req.method });

  if (req.method !== "POST") {
    console.log("[generate] non-POST -> 405");
    return j({ error: "Use POST" }, 405);
  }
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
    console.error("[generate] missing env", { FUELIX_API_BASE: !!FUELIX_API_BASE, FUELIX_API_KEY: !!FUELIX_API_KEY });
    return j({ error: "Server misconfigured" }, 500);
  }

  let payload: any;
  try {
    payload = await req.json();
    console.log("[generate] parsed body");
  } catch (e) {
    console.error("[generate] bad JSON", e);
    return j({ error: "Invalid JSON" }, 400);
  }

  const { personas, base } = payload;

  const system = `You are a marketing copy assistant. Output ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional", "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}
If channel != "email", omit "subjects". Keep each string concise.`;

  const user = `Personas: ${JSON.stringify(personas)}
Base: ${JSON.stringify(base)}`;

  // Build upstream request once.
  const upstream = () =>
    fetch(`${FUELIX_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${FUELIX_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: FUELIX_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
        stream: false, // ensure non-streaming
      }),
    });

  // 9s hard timeout using Promise.race (works even if Abort is ignored by upstream).
  console.log("[generate] about to call FuelIX");
  const START = Date.now();
  try {
    const TIMEOUT_MS = 9000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("UPSTREAM_TIMEOUT")), TIMEOUT_MS)
    );

    const res = (await Promise.race([upstream(), timeout])) as Response;
    console.log("[generate] FuelIX responded in", Date.now() - START, "ms", res.status);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[generate] FuelIX non-OK", res.status, detail.slice(0, 400));
      return j({ error: "FuelIX call failed", status: res.status }, 502);
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const txt = await res.text();
      console.warn("[generate] non-JSON content-type -> passing raw text");
      try { return j(JSON.parse(txt), 200); } catch { return j({ raw: txt }, 200); }
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    try { return j(JSON.parse(content), 200); }
    catch { return j({ raw: content }, 200); }
  } catch (err: any) {
    const dur = Date.now() - START;
    if (err?.message === "UPSTREAM_TIMEOUT") {
      console.warn("[generate] upstream timed out after", dur, "ms");
      return j({ error: "upstream_timeout", ms: dur }, 504);
    }
    console.error("[generate] unexpected error after", dur, "ms", err);
    return j({ error: "server_error" }, 500);
  }
}

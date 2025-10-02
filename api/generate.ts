// api/generate.ts
export const runtime = "nodejs";
export const maxDuration = 10; // Hobby limit ~10s; stay under it

// … keep your env vars …

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // 9s server-side timeout (always sooner than Vercel)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9_000);

  try {
    // …build system/user…
    const r = await fetch(`${FUELIX_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${FUELIX_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: FUELIX_MODEL ?? "gpt-4o-mini", // pick a small/fast model if available
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.5,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[generate] FuelIX error", r.status, detail.slice(0, 500));
      return json({ error: "FuelIX call failed", status: r.status }, 502);
    }

    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const text = await r.text();
      try { return json(JSON.parse(text), 200); } catch { return json({ raw: text }, 200); }
    }

    const data: any = await r.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    try { return json(JSON.parse(content), 200); }
    catch { return json({ raw: content }, 200); }

  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      console.warn("[generate] Upstream timed out at 9s — sending fallback");
      // Return a minimal safe payload your client understands:
      return json({ raw: "Timed out calling model — using local variants." }, 200);
    }
    console.error("[generate] Unexpected error", err);
    return json({ error: "server_error" }, 500);
  }
}

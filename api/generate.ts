// api/generate.ts — Vercel Node function, per-persona generation, fence-tolerant JSON parsing
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const runtime = "nodejs";
export const maxDuration = 30;

// ---- env ----
const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4o";

// ---- minimal types (server) ----
type Channel = "email" | "sms" | "inapp";
interface Persona { name: string; description: string }
interface BaseCreative { brief: string; channel: Channel; subject?: string; message: string }
interface GeneratedVariant {
  tone: "fun/energetic" | "humorous/cheeky" | "formal/professional";
  subjects?: string[];
  bodies: string[];
}

// Utility: accept markdown-fenced JSON or plain JSON
function extractJSON(text: string): any {
  if (!text) return null;
  let s = text.trim();
  // strip ```json ... ``` or ``` ... ```
  if (s.startsWith("```")) {
    // remove first fence line
    const firstNl = s.indexOf("\n");
    s = firstNl >= 0 ? s.slice(firstNl + 1) : s.replace(/^```+/, "");
    // remove trailing ```
    s = s.replace(/```+$/m, "").trim();
  }
  try { return JSON.parse(s); } catch { return null; }
}

function badRequest(res: VercelResponse, msg: string) {
  return res.status(400).json({ error: msg });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) return res.status(500).json({ error: "Server misconfigured" });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body ?? {};
  const personas = (body as any)?.personas as Persona[] | undefined;
  const base = (body as any)?.base as BaseCreative | undefined;
  if (!Array.isArray(personas) || !base) return badRequest(res, "Expected { personas: Persona[], base: BaseCreative }");

  // 9s per request timeout (under Vercel hobby limit)
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9_000);

  try {
    // Generate per persona (keeps outputs distinct)
    const byPersona: { idx: number; variants: GeneratedVariant[] }[] = [];

    for (let idx = 0; idx < personas.length; idx++) {
      const persona = personas[idx];

      const system = `
      You are a senior lifecycle copywriter. You will receive:

      - personas: Array<{ name: string; description: string }>
      - base: { channel: "email" | "sms" | "inapp"; subject?: string; message: string; brief: string }

      GOAL
      - For each persona, produce copy that feels *distinctly* tailored to their motivations and objections.
      - Do **not** reuse sentences or identical wording across personas.
      - Address the reader in second person, but weave in persona-specific hooks drawn from the description.

      DIFFERENTIATION RULES
      - Value/Deal seekers: price-sensitivity, simplicity, quick wins, “save”, “unlock value”, short action steps.
      - Premium/Status: exclusivity, seamlessness, perks, priority treatment, “effortless”, “concierge”.
      - Family/Time-poor: time savings, predictability, reminders, kid/household coordination angles.
      - Curious/Tech-forward: newness, power features, discovery, smart defaults, “under the hood”.

      STYLE
      - Keep each body 1–3 short sentences. Vary sentence structure *between personas*.
      - If channel = "sms" or "inapp", keep each body under ~220 chars and omit subjects.

      OUTPUT (strict JSON):
      {
        "byPersona": [
          { "idx": number, "variants": [
            { "tone": "fun/energetic", "subjects"?: string[], "bodies": string[] },
            { "tone": "humorous/cheeky", "subjects"?: string[], "bodies": string[] },
            { "tone": "formal/professional", "subjects"?: string[], "bodies": string[] }
          ]}
        ]
      }
      `.trim();

      const user = `Persona: ${JSON.stringify(persona)}
Base: ${JSON.stringify(base)}`;

      const r = await fetch(`${FUELIX_API_BASE}/v1/chat/completions`, {
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
          temperature: 0.9,
          top_p: 0.95,
          presence_penalty: 0.6,
          frequency_penalty: 0.3,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        console.error("[generate] Fuel iX error", r.status, detail.slice(0, 500));
        return res.status(502).json({ error: "Fuel iX call failed", status: r.status });
      }

      const ct = r.headers.get("content-type") || "";
      let variants: GeneratedVariant[] | null = null;

      if (ct.startsWith("application/json")) {
        // OpenAI-compatible response
        const data = await r.json() as { choices?: { message?: { content?: string } }[] };
        const content = data?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJSON(content);
        variants = Array.isArray(parsed?.variants) ? parsed.variants : null;
        if (!variants && parsed) {
          // Some models nest slightly differently; last resort try to coerce
          if (Array.isArray(parsed)) variants = parsed as any;
        }
        if (!variants && !parsed) {
          // content was plain text; treat as raw
          return res.status(200).json({ raw: content });
        }
      } else {
        // Provider gave text; attempt to parse it
        const text = await r.text();
        const parsed = extractJSON(text);
        variants = Array.isArray(parsed?.variants) ? parsed.variants : null;
        if (!variants) return res.status(200).json({ raw: text });
      }

      byPersona.push({ idx, variants: variants! });
    }

    clearTimeout(t);
    return res.status(200).json({ byPersona });
  } catch (err: any) {
    clearTimeout(t);
    if (err?.name === "AbortError") {
      console.warn("[generate] upstream timeout");
      return res.status(504).json({ raw: "Timed out calling model — using local variants." });
    }
    console.error("[generate] error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

// helpers
function safeParse(s: string) { try { return JSON.parse(s); } catch { return {}; } }

// api/generate.ts
export const runtime = "nodejs";
export const maxDuration = 10;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }
  const base  = !!process.env.FUELIX_API_BASE;
  const key   = !!process.env.FUELIX_API_KEY;
  const model = process.env.FUELIX_MODEL ?? "(none)";
  return Response.json({ ok: true, env: { base, key, model } }, { status: 200 });
}

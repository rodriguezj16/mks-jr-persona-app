// api/generate.ts
export const runtime = "nodejs";
export const maxDuration = 10;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }
  return Response.json({ ok: true, hello: "generate works" }, { status: 200 });
}

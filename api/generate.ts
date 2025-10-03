// api/generate.ts — deprecated, points to /api/generate-persona
export const runtime = "nodejs";
export default function handler() {
  return new Response(
    JSON.stringify({
      error: "Deprecated endpoint",
      use: "/api/generate-persona (one persona per request)",
    }),
    {
      status: 410, // Gone
      headers: { "content-type": "application/json" },
    }
  );
}

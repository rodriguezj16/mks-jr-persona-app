// api/generate.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.FL_API_KEY, // set in Vercel → Project → Settings → Environment Variables
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { personas, base } = req.body ?? {};

    // Shape the model output to match your UI: {tone, subjects?, bodies}
    const prompt = `
You are a veteran marketing manager with a talent for personalized messaging copy. Given Personas and a Base Creative, produce for EACH tone
["fun/energetic","humorous/cheeky","formal/professional"] exactly 3 message bodies.
If channel is "email", also produce exactly 3 subject lines per tone.
Return ONLY JSON matching:
{
  "variants": [
    { "tone": "fun/energetic", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional", "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}

Personas: ${JSON.stringify(personas)}
Base: ${JSON.stringify(base)}
`.trim();

    const rsp = await client.responses.create({
      model: "gpt-4o-mini",     // adjust as you like
      input: prompt,
    });

    // SDK convenience accessor for text
    const text = rsp.output_text;

    // Try to parse JSON (strongly encouraged by the prompt)
    try {
      const parsed = JSON.parse(text);
      return res.status(200).json(parsed);
    } catch {
      // Fallback: return text so the UI can still show something
      return res.status(200).json({ raw: text });
    }
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "LLM call failed" });
  }
}

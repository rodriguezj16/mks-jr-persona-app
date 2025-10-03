import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, ChevronLeft, ChevronRight, Sparkles, Plus, Trash } from "lucide-react";

// ------------------------------------------------------------
// AI Persona Creative Simulator (Standalone Page Component)
// - Up to 3 personas (name + description)
// - Base creative (brief + channel + subject if email + message)
// - Output grid: 1 panel per persona; inside each panel a tone carousel
//   (fun/energetic, humorous/cheeky, formal/professional), each with 3 variations
// - Optional: export results as JSON
// ------------------------------------------------------------

const MAX_PERSONAS = 3 as const;
const TONES = ["fun/energetic", "humorous/cheeky", "formal/professional"] as const;

// --- Simple local "generator" for demo (no external API required) ---
function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function clamp(str: string, max: number) {
  if (!str) return str;
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + "…";
}

type Channel = "email" | "sms" | "inapp";

type Persona = {
  name: string;
  description: string;
};

type BaseCreative = {
  brief: string;
  channel: Channel;
  subject?: string;
  message: string;
};

function injectTone(text: string, tone: typeof TONES[number], channel: Channel) {
  const emojis = {
    fun: ["✨", "🎉", "🚀", "🌟", "🔥"],
    cheeky: ["😉", "😏", "🫶", "🤫", "💡"],
  };

  switch (tone) {
    case "fun/energetic": {
      const spice = `${emojis.fun[0]} ${emojis.fun[2]}`;
      return channel === "email" ? `${spice} ${text}` : clamp(`${spice} ${text}`, 220);
    }
    case "humorous/cheeky": {
      const spice = `${emojis.cheeky[0]} ${emojis.cheeky[4]}`;
      return channel === "email" ? `${spice} ${text}` : clamp(`${spice} ${text}`, 220);
    }
    case "formal/professional": {
      const t = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
      return channel === "email" ? t : clamp(t, 220);
    }
  }
}

function personaNudge(text: string, persona: Persona) {
  const p = personaProfile(persona);

  if (p.value) {
    return text
      .replace(/\b(benefit|value)\b/gi, "extra value")
      .replace(/\b(faster|quick)\b/gi, "faster (and cheaper)")
      .concat(" Save on every step.");
  }
  if (p.premium) {
    return text
      .replace(/\b(streamlined|simple)\b/gi, "effortless")
      .replace(/\b(perk|benefit)\b/gi, "exclusive perk")
      .concat(" Concierge-level ease.");
  }
  if (p.family) {
    return text
      .replace(/\b(faster|quick)\b/gi, "faster, on your schedule")
      .replace(/\b(remind|nudge)\b/gi, "keep you on track")
      .concat(" Less juggling, more calm.");
  }
  if (p.curious) {
    return text
      .replace(/\b(new|update)\b/gi, "new build")
      .replace(/\b(feature|perk)\b/gi, "power feature")
      .concat(" Peek under the hood.");
  }
  return text;
}

function vary(subjectOrCopy: string, strategy: number, channel: Channel, persona: Persona) {
  const base = subjectOrCopy.trim();
  const p = personaProfile(persona);

  const valueSubs = [
    `More for less: ${base}`,
    `Unlock extra value now: ${base}`,
    `Cut steps, save money: ${base}`,
  ];
  const premiumSubs = [
    `Effortless access: ${base}`,
    `Your VIP fast track: ${base}`,
    `Welcome perk, no friction: ${base}`,
  ];
  const familySubs = [
    `Faster, calmer starts: ${base}`,
    `Set-and-go for busy days: ${base}`,
    `One tap, less juggling: ${base}`,
  ];
  const curiousSubs = [
    `New build unlocked: ${base}`,
    `Smarter start: ${base}`,
    `Explore the upgrade: ${base}`,
  ];

  const pool =
    p.value ? valueSubs :
    p.premium ? premiumSubs :
    p.family ? familySubs :
    curiousSubs;

  if (channel === "email") return pool[(strategy - 1) % pool.length];

  // SMS/In-App (headline fragments)
  const alt =
    p.value ? ["Save now", "Trim steps", "Unlock more"] :
    p.premium ? ["Effortless entry", "Priority path", "Seamless start"] :
    p.family ? ["Less juggling", "Right on time", "Easy start"] :
    ["Smarter defaults", "New in this build", "Explore more"];

  return `${alt[(strategy - 1) % alt.length]}. ${base}`;
}

function generateEmailSubject(subject: string, tone: typeof TONES[number], persona: Persona) {
  const base = subject || "Today’s update";
  const candidates = [1, 2, 3].map((i) => vary(base, i, "email", persona));
  return candidates.map((c) => injectTone(personaNudge(c, persona), tone, "email"));
}

function summarizeBrief(brief: string) {
  if (!brief) return "";
  const s = brief.replace(/\s+/g, " ").trim();
  return clamp(s, 140);
}

function generateBodyCopy(message: string, brief: string, persona: Persona, tone: typeof TONES[number], channel: Channel) {
  const summary = summarizeBrief(brief);
  const base = message || "Here’s what’s new.";

  const p = personaProfile(persona);
  const valueBodies = [
    `Benefit-first: ${base}${summary ? ` — ${summary}` : ""} Cut steps and keep more in your pocket.`,
    `Quick take: ${base} ${summary ? `(${summary})` : ""}. Simple setup, real savings.`,
    `Your move: ${base}${summary ? ` — ${summary}` : ""} Start in minutes and bank the value.`,
  ];
  const premiumBodies = [
    `Benefit-first: ${base}${summary ? ` — ${summary}` : ""} An effortless, concierge-level start.`,
    `Quick take: ${base} ${summary ? `(${summary})` : ""}. Seamless onboarding, priority treatment.`,
    `Your move: ${base}${summary ? ` — ${summary}` : ""} Enjoy exclusive perks right away.`,
  ];
  const familyBodies = [
    `Benefit-first: ${base}${summary ? ` — ${summary}` : ""} Faster starts that fit your schedule.`,
    `Quick take: ${base} ${summary ? `(${summary})` : ""}. Less juggling, clear next step.`,
    `Your move: ${base}${summary ? ` — ${summary}` : ""} Set-and-go in minutes.`,
  ];
  const curiousBodies = [
    `Benefit-first: ${base}${summary ? ` — ${summary}` : ""} Smarter defaults and a cleaner flow.`,
    `Quick take: ${base} ${summary ? `(${summary})` : ""}. Power features, no clutter.`,
    `Your move: ${base}${summary ? ` — ${summary}` : ""} Explore the upgrade in seconds.`,
  ];

  const pool = p.value ? valueBodies : p.premium ? premiumBodies : p.family ? familyBodies : curiousBodies;
  return pool.map((s) => injectTone(personaNudge(s, persona), tone, channel));
}

type GeneratedVariant = {
  tone: typeof TONES[number];
  subjects?: string[];
  bodies: string[];
};

function generateForPersona(persona: Persona, base: BaseCreative): GeneratedVariant[] {
  const { channel, subject = "", message, brief } = base;
  return TONES.map((tone) => {
    const bodies = generateBodyCopy(message, brief, persona, tone, channel);
    const subjects = channel === "email" ? generateEmailSubject(subject, tone, persona) : undefined;
    return { tone, bodies, subjects };
  });
}

// -------------------------- UI Helpers --------------------------
function Section({ title, children, subtitle }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function PersonaEditor({
  index,
  value,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  value: Persona;
  onChange: (v: Persona) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Persona {index + 1}</CardTitle>
        {canRemove && (
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove persona ${index + 1}`}>
            <Trash className="w-4 h-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`persona-name-${index}`}>Name</Label>
          <Input
            id={`persona-name-${index}`}
            placeholder="e.g., Value-Seeker Vanessa"
            value={value.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`persona-desc-${index}`}>Description</Label>
          <Textarea
            id={`persona-desc-${index}`}
            placeholder="Who are they? Goals, pains, behaviors…"
            value={value.description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ ...value, description: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function personaProfile(p: Persona) {
  const d = (p.description + " " + p.name).toLowerCase();
  return {
    value: /value|deal|budget|save|frugal/.test(d),
    premium: /premium|vip|status|luxury|convenience|frequent/.test(d),
    family: /family|parent|kids|household|busy/.test(d),
    curious: /tech|power|explore|curious|early adopter|discover/.test(d),
  };
}

function PersonaPanel({
  persona,
  variants,
}: {
  persona: Persona;
  variants: GeneratedVariant[];
}) {
  // Only the tones we actually have for this persona
  const tones = (variants ?? []).map(v => v.tone);
  const [toneIndex, setToneIndex] = useState(0);

  // Keep index in range if new data arrives
  useEffect(() => {
    if (toneIndex >= tones.length) setToneIndex(0);
  }, [tones.length, toneIndex]);

  const hasData = tones.length > 0;
  const active = hasData ? variants[toneIndex] : undefined;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">
              {persona.name || "Untitled Persona"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {persona.description || "(no description)"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setToneIndex((p) => (p - 1 + tones.length) % tones.length)
              }
              aria-label="Previous tone"
              disabled={!hasData || tones.length <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Badge variant="secondary" className="text-[11px] px-2 py-1">
              {hasData ? active?.tone : "no results"}
            </Badge>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setToneIndex((p) => (p + 1) % tones.length)}
              aria-label="Next tone"
              disabled={!hasData || tones.length <= 1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!hasData ? (
          <div className="rounded-2xl border p-4 text-sm leading-relaxed bg-muted/40">
            No results from the remote API for this persona. Try generating again.
          </div>
        ) : (
          <>
            {/* Subjects (email only, if provided) */}
            {Array.isArray(active?.subjects) && active!.subjects.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm font-semibold">Subject line variations</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {active!.subjects.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Bodies */}
            <div className="space-y-2">
              <div className="text-sm font-semibold">Message variations</div>

              {Array.isArray(active?.bodies) && active!.bodies.length > 0 ? (
                <Tabs defaultValue="0" className="w-full">
                  <TabsList className="grid grid-cols-3">
                    {active!.bodies.map((_, i) => (
                      <TabsTrigger key={i} value={String(i)}>
                        {`Variation ${i + 1}`}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {active!.bodies.map((b, i) => (
                    <TabsContent key={i} value={String(i)}>
                      <div className="rounded-2xl border p-4 text-sm leading-relaxed bg-muted/40 whitespace-pre-wrap">
                        {b}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <div className="rounded-2xl border p-4 text-sm leading-relaxed bg-muted/40">
                  No message variations were returned for this tone.
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


export default function PersonaCreativeSimulator() {
  const [personas, setPersonas] = useState<Persona[]>([
    { name: "Value-Seeker Vanessa", description: "Budget-conscious, hunts deals, responds to clear savings and simple steps." },
    { name: "Premium Peter", description: "Frequent buyer, prioritizes convenience, status, and best-in-class experiences." },
  ]);
  const [base, setBase] = useState<BaseCreative>({
    brief: "Announce a new perk that makes onboarding faster and highlights immediate value.",
    channel: "email",
    subject: "Welcome perk: faster start, more value",
    message: "We’ve streamlined your first steps so you get to benefits sooner.",
  });
  const [results, setResults] = useState<Record<number, GeneratedVariant[]>>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const canAddPersona = personas.length < MAX_PERSONAS;

// put these helpers above the component or inside it before handleGenerate
  async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeoutMs?: number } = {}) {
    const { timeoutMs = 15000, ...rest } = init;
    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(input, { ...rest, signal: controller.signal });
      return r;
    } finally {
      clearTimeout(t);
    }
  }

  // normalize the API’s response into our GeneratedVariant[] shape
  function toVariants(payload: any): GeneratedVariant[] | null {
    if (Array.isArray(payload?.variants)) return payload.variants as GeneratedVariant[];
    if (payload?.raw) {
      // raw string fallback from server
      return [{ tone: "formal/professional", bodies: [String(payload.raw)] }];
    }
    return null;
  }

  const handleGenerate = async () => {
    setLoading(true);
    setApiError(null);

    // fan-out one request per persona; per-request timeout & one retry
    const resultsMap: Record<number, GeneratedVariant[]> = {};
    const failedIdxs: number[] = [];

    for (let idx = 0; idx < personas.length; idx++) {
      const persona = personas[idx];
      const body = JSON.stringify({ persona, base });

      let final: GeneratedVariant[] | null = null;

      for (let attempt = 0; attempt < 2 && !final; attempt++) {
        try {
          const r = await fetchWithTimeout("/api/generate-persona", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            timeoutMs: 18000, // per-call timeout (18s)
          });

          if (!r.ok) throw new Error(`HTTP ${r.status}`);

          // API returns JSON; normalize
          const data = await r.json();
          final = toVariants(data);
        } catch (_err) {
          // brief jitter before the single retry
          if (attempt === 0) await new Promise((res) => setTimeout(res, 250));
        }
      }

      if (final) {
        resultsMap[idx] = final;
      } else {
        failedIdxs.push(idx);
      }
    }

    // stitch results; only fill the failed personas with local variants
    if (failedIdxs.length > 0) {
      failedIdxs.forEach((i) => {
        resultsMap[i] = generateForPersona(personas[i], base);
      });
      setApiError(
        "Remote API returned incomplete data for some personas; filled only those gaps with local variants."
      );
    }

    setResults(resultsMap);
    setLoading(false);
  };


  const exportJson = () => {
    const payload = {
      personas,
      base,
      generated: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v])),
      meta: { createdAt: new Date().toISOString() },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `persona-creative-simulator-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const channelDisplay = useMemo(
    () => ({
      email: "Email",
      sms: "SMS",
      inapp: "In-App",
    }),
    []
  );

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-8">
      {/* API error banner */}
      {apiError && (
        <div className="mb-4 rounded-lg border border-amber-400 bg-amber-50 text-amber-900 p-3 text-sm">
          {apiError}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Sparkles className="w-6 h-6" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Persona Creative Simulator</h1>
          <p className="text-sm text-muted-foreground">
            Generate persona-tailored creative variations by tone across Email, SMS, or In-App.
          </p>
          <div className="mt-2 h-1 w-40 bg-gradient-to-r from-fuchsia-400 via-amber-400 to-sky-400 rounded-full opacity-70" />
        </div>
      </div>

      {/* Input Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Personas Column */}
        <div className="lg:col-span-1 space-y-4">
          <Section title="Personas" subtitle="Up to 3 (name + description)">
            <div className="space-y-3">
              {personas.map((p, i) => (
                <PersonaEditor
                  key={i}
                  index={i}
                  value={p}
                  onChange={(v) => setPersonas((arr) => arr.map((pp, idx) => (idx === i ? v : pp)))}
                  onRemove={() => setPersonas((arr) => arr.filter((_, idx) => idx !== i))}
                  canRemove={personas.length > 1}
                />
              ))}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => canAddPersona && setPersonas((arr) => [...arr, { name: "", description: "" }])}
                  disabled={!canAddPersona}
                >
                  <Plus className="w-4 h-4 mr-1" /> Add persona
                </Button>
              </div>
            </div>
          </Section>
        </div>

        {/* Base Creative Column */}
        <div className="lg:col-span-2 space-y-4">
          <Section title="Base Creative" subtitle="Brief, channel, subject (email), and message">
            <Card className="shadow-sm">
              <CardContent className="space-y-4 p-4">
                <div className="space-y-1">
                  <Label htmlFor="brief">Creative brief</Label>
                  <Textarea
                    id="brief"
                    placeholder="What are we trying to achieve? Key benefit, audience, CTA, constraints…"
                    value={base.brief}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBase((b) => ({ ...b, brief: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label>Channel</Label>
                    <Select value={base.channel} onValueChange={(v: string) => setBase((b) => ({ ...b, channel: v as Channel }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a channel" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="inapp">In-App</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {base.channel === "email" && (
                    <div className="md:col-span-2 space-y-1">
                      <Label htmlFor="subject">Original subject line</Label>
                      <Input
                        id="subject"
                        placeholder="e.g., Welcome to faster rewards"
                        value={base.subject}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBase((b) => ({ ...b, subject: e.target.value }))}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="message">Original message ({titleCase(channelDisplay[base.channel])})</Label>
                  <Textarea
                    id="message"
                    placeholder="Baseline copy to transform into variations"
                    value={base.message}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBase((b) => ({ ...b, message: e.target.value }))}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button onClick={handleGenerate} disabled={loading}>
                    {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />} Generate variations
                  </Button>
                  <Button variant="outline" onClick={exportJson} disabled={Object.keys(results).length === 0}>
                    <Download className="w-4 h-4 mr-2" /> Export JSON
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Section>
        </div>
      </div>

      {/* Results */}
      <Section title="Results" subtitle="One panel per persona; cycle tones; three variations per tone">
        {Object.keys(results).length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Fill in personas and base creative, then click <span className="font-medium">Generate variations</span>.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {personas.map((p, i) => (
              <PersonaPanel key={i} persona={p} variants={results[i] || []} />
            ))}
          </div>
        )}
      </Section>

      {/* Notes / Implementation Tips */}
      <Card className="bg-muted/40">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1 leading-relaxed">
          <div className="font-medium text-foreground">Implementation Notes</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              This demo uses a deterministic local generator to avoid external calls. Swap <code>handleGenerate()</code> with a server
              endpoint that calls your preferred LLM and passes <code>persona</code>, <code>brief</code>, <code>channel</code>,{" "}
              <code>subject</code>, and <code>message</code> as structured inputs.
            </li>
            <li>
              For email, three subject lines are produced; for SMS/In-App, only message bodies are shown. The local generator also clamps
              SMS/In-App length ~220 chars.
            </li>
            <li>
              Consider persisting sessions and team templates, then logging which variations are selected to build a feedback dataset for
              offline fine-tuning.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

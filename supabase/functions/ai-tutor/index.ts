import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !anonKey) return respond(500, { error: "Supabase function configuration is incomplete." });
    if (!openAiKey) return respond(503, { error: "AI tutor is not configured yet: add the OPENAI_API_KEY secret to the Supabase project Edge Function secrets. Do not put this key in website code." });

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return respond(401, { error: "Please sign in to use the AI tutor." });
    const token = auth.slice(7);
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !userData.user) return respond(401, { error: "Your session is invalid or expired. Please sign in again." });

    const body = await req.json().catch(() => ({}));
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) return respond(400, { error: "Enter a question for the tutor." });
    if (question.length > 1200) return respond(413, { error: "Please keep questions under 1,200 characters." });

    const systemPrompt = `You are CyberShield AI Tutor, a friendly, accurate cybersecurity and computer-science tutor for learners. Explain clearly and step by step at a beginner-friendly level. Give safe, legal, authorised practice guidance only. Do not assist with credential theft, malware deployment, evasion, attacking real targets, or unauthorised access; redirect to defensive concepts or intentionally vulnerable labs. Never claim you ran code or checked a live system. Do not request passwords, API keys, or personal data. Return only valid JSON with this schema: {"answer":"A clear text answer, usually 2-6 short paragraphs","recap":"A 1-2 sentence recap","slides":[{"heading":"short slide heading","narration":"2-4 sentence narration explaining one idea","visual":"intro|concept|example|steps|warning|recap|network|code"}],"quiz_question":"one quick check question","quiz_answer":"short correct answer"}. Create 3-6 useful slides that together teach the answer, with an intro and recap when useful. Ensure each slide narration is suitable for text-to-speech. If the question is ambiguous, state your assumption in the answer. No markdown fences.`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("OpenAI request failed", response.status, result?.error?.type ?? "unknown");
      return respond(502, { error: response.status === 429 ? "The AI service is busy or its quota is exhausted. Try again later." : "The AI service could not answer this request. Check the configured API key and service quota." });
    }
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return respond(502, { error: "The AI service returned no answer. Please try again." });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(content); } catch { return respond(502, { error: "The AI response could not be formatted as a lesson. Please try again." }); }
    if (typeof parsed.answer !== "string" || !parsed.answer.trim()) return respond(502, { error: "The AI response did not contain an answer." });
    const slides = Array.isArray(parsed.slides) ? parsed.slides.slice(0, 8).map((s: Record<string, unknown>) => ({
      heading: String(s?.heading ?? "Key idea").slice(0, 140),
      narration: String(s?.narration ?? "").slice(0, 900),
      visual: String(s?.visual ?? "concept").slice(0, 30),
    })).filter((s: { narration: string }) => s.narration) : [];
    return respond(200, {
      answer: String(parsed.answer).slice(0, 7000),
      recap: String(parsed.recap ?? "").slice(0, 800),
      slides,
      quiz_question: String(parsed.quiz_question ?? "").slice(0, 500),
      quiz_answer: String(parsed.quiz_answer ?? "").slice(0, 500),
    });
  } catch (error) {
    console.error("ai-tutor failed", error instanceof Error ? error.message : "unknown error");
    return respond(500, { error: "The AI tutor encountered a server error. Please try again later." });
  }
});
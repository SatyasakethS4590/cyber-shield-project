import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const plans = {
  "monthly-premium": { amount: 9900, label: "Monthly Premium — 30 days" },
  "full-course": { amount: 53900, label: "CyberShield Full Course" },
} as const;

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!supabaseUrl || !anonKey || !serviceKey || !razorpayKeyId || !razorpaySecret) {
      return respond(500, { error: "Server configuration is incomplete. Check the required Supabase and Razorpay function secrets." });
    }

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return respond(401, { error: "Please sign in before checkout." });
    const token = authorization.slice(7);
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData.user) return respond(401, { error: "Your session is invalid or expired. Please sign in again." });

    const body = await req.json().catch(() => ({}));
    const planId = body?.plan;
    if (typeof planId !== "string" || !(planId in plans)) return respond(400, { error: "Choose a valid CyberShield plan." });
    const plan = plans[planId as keyof typeof plans];

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (planId === "full-course") {
      const { data: existing, error } = await admin.from("course_entitlements")
        .select("id").eq("user_id", userData.user.id).eq("plan", "full-course").eq("status", "active").limit(1);
      if (error) return respond(500, { error: "Could not check existing course access." });
      if (existing?.length) return respond(409, { error: "This account already has full-course access." });
    }

    const receipt = `cs_${planId === "full-course" ? "course" : "premium"}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${razorpayKeyId}:${razorpaySecret}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: plan.amount,
        currency: "INR",
        receipt,
        notes: { user_id: userData.user.id, plan: planId },
      }),
    });
    const order = await response.json().catch(() => ({}));
    if (!response.ok || !order?.id) {
      console.error("Razorpay order creation failed", response.status, order?.error?.code ?? "unknown");
      return respond(502, { error: "Razorpay could not create the order. Check the server-side Razorpay credentials and account status." });
    }

    return respond(200, {
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: razorpayKeyId,
      plan: planId,
    });
  } catch (error) {
    console.error("create-order failed", error instanceof Error ? error.message : "unknown error");
    return respond(500, { error: "Could not create the secure payment order. Check the Edge Function logs." });
  }
});

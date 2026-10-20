import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const modulePrices: Record<string, { amount: number; label: string }> = {
  basics: { amount: 9900, label: "Security Basics" },
  networking: { amount: 9900, label: "Networking" },
  linux: { amount: 9900, label: "Linux Essentials" },
  "web-security": { amount: 9900, label: "Web Security" },
  cryptography: { amount: 9900, label: "Cryptography" },
  awareness: { amount: 9900, label: "Security Awareness" },
  "kali-linux": { amount: 14900, label: "Kali Linux" },
};
const fullCourseAmount = 53900;
function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
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
    if (!authorization.startsWith("Bearer ")) return respond(401, { error: "Please sign in before verifying payment." });
    const token = authorization.slice(7);
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData.user) return respond(401, { error: "Your session is invalid or expired. Please sign in again." });
    const body = await req.json().catch(() => ({}));
    const orderId = body?.razorpay_order_id ?? body?.order_id;
    const paymentId = body?.razorpay_payment_id ?? body?.payment_id;
    const signature = body?.razorpay_signature ?? body?.signature;
    const planId = body?.plan;
    if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string" ||
        typeof planId !== "string" || !["monthly-premium", "full-course", "selected-modules"].includes(planId)) {
      return respond(400, { verified: false, activated: false, error: "Payment verification details are incomplete." });
    }
    let selectedModules: string[] = [];
    let amount = 0;
    let receiptPlan = planId;
    let days: number | null = null;
    if (planId === "monthly-premium") { amount = 19900; days = 30; }
    else if (planId === "full-course") amount = fullCourseAmount;
    else {
      if (!Array.isArray(body?.modules) || body.modules.length === 0 ||
          body.modules.some((id: unknown) => typeof id !== "string" || !Object.hasOwn(modulePrices, id))) {
        return respond(400, { verified: false, activated: false, error: "Selected modules are missing or invalid." });
      }
      selectedModules = [...new Set(body.modules as string[])].sort();
      if (selectedModules.length !== body.modules.length || selectedModules.length >= Object.keys(modulePrices).length) {
        return respond(400, { verified: false, activated: false, error: "Use the complete-course plan when all modules are selected." });
      }
      amount = selectedModules.reduce((sum,id)=>sum+modulePrices[id].amount,0);
      receiptPlan = "selected-modules:" + selectedModules.join(",");
    }
    const expectedSignature = await hmacHex(razorpaySecret, `${orderId}|${paymentId}`);
    if (!safeEqual(expectedSignature, signature)) return respond(400, { verified: false, activated: false, error: "Razorpay signature verification failed." });
    const basic = "Basic " + btoa(`${razorpayKeyId}:${razorpaySecret}`);
    const [paymentResponse, orderResponse] = await Promise.all([
      fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: basic } }),
      fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: basic } }),
    ]);
    const payment = await paymentResponse.json().catch(() => ({}));
    const order = await orderResponse.json().catch(() => ({}));
    if (!paymentResponse.ok || !orderResponse.ok) return respond(502, { verified: false, activated: false, error: "Could not confirm the transaction with Razorpay. Do not pay again; retry verification later." });
    if (order.id !== orderId || payment.order_id !== orderId || payment.id !== paymentId ||
        order.notes?.user_id !== userData.user.id || order.notes?.plan !== planId ||
        (order.notes?.modules || "") !== selectedModules.join(",") ||
        Number(order.amount) !== amount || Number(payment.amount) !== amount ||
        order.currency !== "INR" || payment.currency !== "INR") {
      return respond(400, { verified: false, activated: false, error: "Payment details do not match this account and selected plan." });
    }
    if (payment.status !== "captured") return respond(409, { verified: false, activated: false, error: "Payment is not captured yet. Access activates after Razorpay confirms capture." });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date();
    const { data: priorReceipts, error: receiptReadError } = await admin.from("course_payment_receipts")
      .select("payment_id,order_id,user_id,plan,expires_at").eq("payment_id", paymentId).limit(1);
    if (receiptReadError) return respond(500, { verified: true, activated: false, error: "Payment is verified, but its receipt could not be checked. Contact support with the payment ID." });
    let expiresAt: string | null = priorReceipts?.[0]?.expires_at ?? null;
    if (priorReceipts?.length) {
      const receipt = priorReceipts[0];
      if (receipt.user_id !== userData.user.id || receipt.plan !== receiptPlan || receipt.order_id !== orderId) {
        return respond(409, { verified: true, activated: false, error: "This payment has already been associated with a different account, plan, or order." });
      }
    } else {
      if (days) {
        const { data: existing, error: existingError } = await admin.from("course_entitlements")
          .select("id,expires_at,status").eq("user_id", userData.user.id).eq("plan", planId).limit(1);
        if (existingError) return respond(500, { verified: true, activated: false, error: "Payment is verified, but entitlement storage failed." });
        const currentExpiry = existing?.[0]?.status === "active" && existing[0].expires_at && new Date(existing[0].expires_at) > now
          ? new Date(existing[0].expires_at) : now;
        currentExpiry.setDate(currentExpiry.getDate() + days);
        expiresAt = currentExpiry.toISOString();
      }
      const { error: receiptInsertError } = await admin.from("course_payment_receipts").insert({
        payment_id: paymentId, order_id: orderId, user_id: userData.user.id, plan: receiptPlan, expires_at: expiresAt,
      });
      if (receiptInsertError) {
        const { data: raced, error: racedError } = await admin.from("course_payment_receipts")
          .select("payment_id,order_id,user_id,plan,expires_at").eq("payment_id", paymentId).limit(1);
        if (racedError || !raced?.length || raced[0].user_id !== userData.user.id ||
            raced[0].plan !== receiptPlan || raced[0].order_id !== orderId) {
          return respond(409, { verified: true, activated: false, error: "This payment could not be recorded safely. Contact support with the payment ID." });
        }
        expiresAt = raced[0].expires_at;
      }
    }
    const entitlementPlans = planId === "selected-modules" ? selectedModules.map(id => "module-" + id) : [planId];
    for (const entitlementPlan of entitlementPlans) {
      const entitlement = {
        user_id: userData.user.id, plan: entitlementPlan, status: "active",
        expires_at: expiresAt, razorpay_order_id: orderId, razorpay_payment_id: paymentId,
        updated_at: now.toISOString(),
      };
      const { error: saveError } = await admin.from("course_entitlements")
        .upsert(entitlement, { onConflict: "user_id,plan" });
      if (saveError) {
        console.error("Entitlement save failed", entitlementPlan, saveError.message);
        return respond(500, { verified: true, activated: false, error: "Payment is verified, but course access could not be activated. Contact support with the payment ID." });
      }
    }
    return respond(200, { verified: true, activated: true, plan: planId, modules: selectedModules, expires_at: expiresAt });
  } catch (error) {
    console.error("verify-payment failed", error instanceof Error ? error.message : "unknown error");
    return respond(500, { verified: false, activated: false, error: "Could not verify payment. Check the Edge Function logs." });
  }
});
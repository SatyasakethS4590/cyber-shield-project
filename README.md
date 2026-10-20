# CyberShield

CyberShield is a browser-based cybersecurity learning platform. The six-module learning path is designed around approximately 6 hours of lessons and 4 hours of practice. Progress/profile remain prototype features stored in Supabase Auth user metadata.

## Pages
- `index.html`: homepage and Free, Monthly Premium, and one-time Full Course plans.
- `auth.html`: Supabase sign-up and login.
- `dashboard.html`: learning dashboard, plan cards, and progress.
- `checkout.html`: Razorpay checkout for ₹99 / 30-day Monthly Premium and ₹539 one-time Full Course.
- `courses.html`: six foundational modules with embedded videos, notes, quick checks, and completion tracking.
- `labs.html`: four safe labs using fictional/local data.
- `quizzes.html` and `final-exam.html`: practice quiz and final assessment.
- `profile.html`: profile/avatar customisation and current entitlement display.
- `ai-tutor.html`: local keyword-based topic guide, not a live generative AI tutor.
- `achievements.html`, `certificate.html`, and `certificates.html`: progress and platform completion certificate pages.

## Payment backend added in this repository
- `supabase/functions/create-order/index.ts`: authenticates the signed-in user, uses server-side plan pricing, and creates Razorpay orders.
- `supabase/functions/verify-payment/index.ts`: checks the Razorpay signature, fetches the order and payment from Razorpay, validates user/plan/amount/currency/captured status, and activates the entitlement.
- `supabase/migrations/202610200001_course_entitlements.sql`: creates/updates the entitlement table, enables RLS, allows users to read only their own rows, and reserves writes for the service role.

## Required Supabase setup
The source files in GitHub do not deploy Edge Functions or apply database migrations automatically. From a trusted local terminal with the Supabase CLI installed:

```sh
supabase login
supabase link --project-ref hkiszhyzguhhiughbcrj
supabase db push
supabase secrets set RAZORPAY_KEY_ID=your_key_id RAZORPAY_KEY_SECRET=your_key_secret
supabase functions deploy create-order
supabase functions deploy verify-payment
```

Supabase's built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` must be available to the functions. If they are not automatically available in the project, configure them as Edge Function secrets using the Supabase dashboard. Never place the Razorpay secret or service-role key in HTML, JavaScript served to browsers, GitHub, or chat messages. Use test credentials first; only switch to live credentials after test payments and verification pass.

Monthly Premium is a **manual 30-day purchase**, not an auto-renewing Razorpay subscription. The app must not advertise automatic renewal.

## Known limitations
- Payment functions and migration are source changes only until deployed/applied in Supabase. No live payment has been made or verified by this repository update.
- Progress and profile are stored in Supabase Auth user metadata; move grading and certificate issuance to trusted server-side/database logic before production.
- Video embeds are third-party YouTube content. Verify availability, rights, and chapter timestamps before launch.
- Tutor responses are a local topic guide, not a live AI model.
- Certificates are CyberShield platform completion records only, not government-issued or industry-accredited. Public QR verification is not implemented.
- Validate login/email confirmation, RLS policies, deployment, and payment flows in the live environment before announcing production readiness.

Practice only in CyberShield labs, your own devices, or systems where you have explicit permission.

# CyberShield

CyberShield is a browser-based cybersecurity learning project. The new learner pages use the existing Supabase project and store demo progress in Supabase Auth user metadata.

## Pages added
- `courses.html`: six foundational modules with embedded video chapters, lesson notes, quick checks and completion tracking.
- `labs.html`: four local, fictional-data labs.
- `quizzes.html`: practice quiz and 10-question final assessment.
- `profile.html`: account display name and avatar customisation.
- `ai-tutor.html`: local topic-guide tutor (not a live generative AI integration).
- `achievements.html` and `certificate.html`: progress view and platform-issued completion certificate view.
- `cybershield.css` and `cybershield.js`: shared UI and Supabase helpers.

## Important limitations
- Progress and profile are saved to Supabase Auth user metadata for this prototype. This is not a robust authoritative grading/certificate store; production should move this to database tables with Row Level Security and server-side certificate issuance.
- The video is a third-party YouTube course embed. Chapter timestamps are illustrative navigation points and may not align exactly with a publisher's actual chapter boundaries; verify the source and timestamps before launch. Video playback depends on the publisher, network and region.
- Tutor responses are a local keyword-based guide, not a live AI model.
- Certificates are CyberShield platform completion records only, not government or industry accreditation. The certificate page is private to the signed-in user; public QR verification is not implemented.
- Payment integration has not been changed or verified as part of this update.
- Test signup/login, email confirmation, user metadata permissions and GitHub Pages deployment in the real project before announcing production readiness.

Practice only in systems you own or have explicit permission to test.

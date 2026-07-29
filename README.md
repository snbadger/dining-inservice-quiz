# Dining Services In-Service Quiz

Mobile quiz app for monthly dietary staff in-services (12 modules, one per month).
Content based on the DiningRD 2020 Guideline & Procedure Manual for Long Term Care and the FDA 2017 Food Code.

- Staff must score **100%** to pass; unlimited retakes with a key-points review between attempts.
- Attempts are recorded in Supabase (`dining_quiz_attempts`) via the `dining-quiz` edge function.
- On a pass, the Registered Dietitian is notified automatically by email (Resend).
- Facility list is served from `dining_quiz_facilities` (multi-location).

Live: https://snbadger.github.io/dining-inservice-quiz/

Companion in-service lesson packages live in the private workspace:
`01_Work/Jericho/People_and_Culture/Inservices/Dietary_Annual_Program/`

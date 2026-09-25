# Google setup

## Project creation

Create a dedicated personal project in Google Cloud Console and select it.

## OAuth consent screen

Open Google Auth Platform → Branding / Audience / Data Access. Configure the app name, support contact and authorized domain. Choose External for a personal consumer account and add your account as a test user. Login requests only `openid email profile`.
With the consent screen in **Testing**, refresh tokens expire after **7 days** when non-identity scopes such as Calendar are granted. Identity-only grants are exempt. To avoid that testing expiry for personal Calendar use, change Audience → Publishing status to **In production**. A personal app for your own account can remain unverified under Google's personal-use exception; the unverified warning and user cap still apply when sensitive scopes are requested. Do not claim it is verified or public-ready. Workspace policies can impose extra restrictions.
Source: https://developers.google.com/identity/protocols/oauth2 and https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification

## Credentials and redirect URIs

Create an OAuth client of type Web application. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET server-side. Register exactly `http://localhost:3000/api/auth/callback/google` for local development and `https://YOUR_HOST/api/auth/callback/google` for production. Set AUTH_URL to the corresponding origin. Separate development and production clients are recommended.

## Enable Google Calendar API

Enable Google Calendar API in APIs & Services → Library. Do not add its scope to the login request. M4 will request Calendar authorization only when Calendar is enabled in Settings.

## Find ALLOWED_GOOGLE_SUB and ALLOWED_EMAIL

Use Google's OAuth 2.0 Playground with your own OAuth client (add its documented redirect URI temporarily) to request only identity scopes for your account. Inspect the Google-verified userinfo response at `https://openidconnect.googleapis.com/v1/userinfo`: copy its exact `sub` and `email`, and verify `email_verified` is true. Set ALLOWED_GOOGLE_SUB and ALLOWED_EMAIL in the server environment; never guess the subject or use the email as the subject. Remove the Playground redirect afterward. A locally decoded ID token is not identity verification. LifeOS itself rejects all accounts until these variables are correct, so no temporary allow-all bootstrap exists.

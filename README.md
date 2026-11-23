# DrewMingle

A responsive, dark-first community chat prototype for topic-based public rooms.

## Current scope

- Public group rooms by region and topic.
- Anonymous Firebase Authentication (no account form).
- Realtime messages and basic online presence.
- Report-message action.
- Text-only chat with a client-side profanity check.
- No private one-to-one messaging, image uploads, or external links.

## Stack

- React + TypeScript + Vite
- Firebase Authentication (anonymous)
- Firebase Realtime Database
- Framer Motion + Lucide

## 1. Create a separate Firebase project

Create a new Firebase project named `drewmingle` in the Firebase Console. Do not connect it to KapanJadi or ZulStore.

In Firebase:
1. Add a Web App.
2. Enable **Authentication → Sign-in method → Anonymous**.
3. Create a **Realtime Database**.
4. Import `firebase-database.rules.json` in Realtime Database → Rules and publish.
5. Copy the web app config values into the environment variables below.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the Firebase Web App values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

These are Firebase client configuration values, not service-account credentials. Never put a Firebase Admin SDK private key in frontend environment variables.

## 3. Run locally

```bash
npm install
npm run dev
```

## 4. Deploy to Vercel

Import this GitHub repository into Vercel as a Vite project. Build command: `npm run build`. Output directory: `dist`.

Add the five `VITE_FIREBASE_*` variables to Vercel Project Settings → Environment Variables, then redeploy.

## Safety and production limitations

This is a starter implementation, not a fully moderated production service. The report action records a report in the database, but a human moderation workflow, retention policy, abuse-rate limiting, and server-enforced profanity moderation still need to be added before opening rooms to the public. The client-side word filter is only a convenience and can be bypassed. Keep the product limited to public topic rooms; do not add private stranger-to-stranger messaging for teen users. Do not ask users to share identifying or contact information.
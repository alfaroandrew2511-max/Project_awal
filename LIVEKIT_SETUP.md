# DrewMingle voice and video setup

The hangout UI and invite flow use Supabase. Actual audio/video media uses LiveKit.

Add these **Production, Preview, and Development** environment variables to the Vercel project:

- `LIVEKIT_URL`: the LiveKit project WebSocket URL (starts with `wss://`)
- `LIVEKIT_API_KEY`: server-side API key
- `LIVEKIT_API_SECRET`: server-side API secret

Keep `LIVEKIT_API_SECRET` private. Never add it to a `VITE_*` variable, frontend source, GitHub, or a public chat.

The existing Vercel Supabase variables are used by the token endpoint:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

After saving the variables, redeploy DrewMingle. The browser will ask for microphone/camera permission only when a participant turns those controls on. Both start off. A recipient must accept an invitation before the server issues a call token.

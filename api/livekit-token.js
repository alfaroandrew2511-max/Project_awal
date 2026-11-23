
import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authorization = req.headers.authorization || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const livekitUrl = process.env.LIVEKIT_URL;
  const livekitKey = process.env.LIVEKIT_API_KEY;
  const livekitSecret = process.env.LIVEKIT_API_SECRET;

  if (!accessToken) return res.status(401).json({ error: "Authentication required" });
  if (!supabaseUrl || !publishableKey) return res.status(503).json({ error: "Supabase server configuration is missing" });
  if (!livekitUrl || !livekitKey || !livekitSecret) {
    return res.status(503).json({ error: "Call service is not configured yet. Add the LiveKit project credentials in Vercel." });
  }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
  const { data: userData, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !userData.user) return res.status(401).json({ error: "Invalid session" });

  const callRoomId = req.body?.callRoomId;
  const nickname = String(req.body?.nickname || "DrewMingle user").slice(0, 24);
  if (typeof callRoomId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callRoomId)) {
    return res.status(400).json({ error: "Invalid call room" });
  }

  const { data: callRoom, error: roomError } = await client
    .from("drewmingle_call_rooms")
    .select("id,host_id,status,expires_at")
    .eq("id", callRoomId)
    .maybeSingle();
  if (roomError || !callRoom) return res.status(403).json({ error: "Call room not found or access denied" });
  if (callRoom.status !== "active" || new Date(callRoom.expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: "This call room has ended" });
  }

  if (callRoom.host_id !== userData.user.id) {
    const { data: invite } = await client
      .from("drewmingle_call_invites")
      .select("id")
      .eq("room_id", callRoomId)
      .eq("invitee_id", userData.user.id)
      .eq("status", "accepted")
      .maybeSingle();
    if (!invite) return res.status(403).json({ error: "Accept the invitation before joining" });
  }

  try {
    const token = new AccessToken(livekitKey, livekitSecret, {
      identity: userData.user.id,
      name: nickname,
      ttl: "15m",
    });
    token.addGrant({
      roomJoin: true,
      room: "drewmingle-" + callRoomId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    return res.status(200).json({ token: await token.toJwt(), serverUrl: livekitUrl });
  } catch {
    return res.status(500).json({ error: "Could not create call access token" });
  }
}


import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Mic, MicOff, Camera, CameraOff, PhoneOff } from "lucide-react";
import { Room, RoomEvent, Track } from "livekit-client";
import { supabase } from "./supabase";

type CallPanelProps = {
  callRoomId: string;
  callType: "voice" | "video";
  nickname: string;
  onLeave: () => void;
};

type MediaItem = { id: string; track: Track; name: string };

function RemoteMedia({ item }: { item: MediaItem }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    item.track.attach(element);
    return () => { item.track.detach(element); };
  }, [item.track]);
  if (item.track.kind === Track.Kind.Video) {
    return <div className="call-video-tile"><video ref={mediaRef as RefObject<HTMLVideoElement>} autoPlay playsInline /><span className="call-video-name">{item.name}</span></div>;
  }
  return <audio ref={mediaRef as RefObject<HTMLAudioElement>} autoPlay />;
}

export function CallPanel({ callRoomId, callType, nickname, onLeave }: CallPanelProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteMedia, setRemoteMedia] = useState<MediaItem[]>([]);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let currentRoom: Room | null = null;
    const connect = async () => {
      if (!supabase) {
        setError("Sesi DrewMingle belum tersedia. Muat ulang halaman.");
        setJoining(false);
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("Sesi login tidak ditemukan.");
        const response = await fetch("/api/livekit-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
          body: JSON.stringify({ callRoomId, nickname }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Panggilan tidak dapat dimulai.");
        if (cancelled) return;
        currentRoom = new Room({ adaptiveStream: true, dynacast: true });
        currentRoom.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
          const trackId = track.sid ?? `${participant.identity}-${track.kind}`;
          setRemoteMedia((items) => items.some((item) => item.id === trackId) ? items : [...items, { id: trackId, track, name: participant.name || "Participant" }]);
        });
        currentRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
          setRemoteMedia((items) => items.filter((item) => item.id !== track.sid));
        });
        currentRoom.on(RoomEvent.Disconnected, () => setConnected(false));
        await currentRoom.connect(payload.serverUrl, payload.token);
        if (cancelled) {
          await currentRoom.disconnect();
          return;
        }
        setRoom(currentRoom);
        setConnected(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Koneksi panggilan gagal.");
      } finally {
        if (!cancelled) setJoining(false);
      }
    };
    void connect();
    return () => {
      cancelled = true;
      if (currentRoom) void currentRoom.disconnect();
    };
  }, [callRoomId, nickname]);

  const toggleMic = async () => {
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!micOn);
      setMicOn((value) => !value);
    } catch {
      setError("Mikrofon tidak dapat diaktifkan. Periksa izin browser.");
    }
  };

  const toggleCamera = async () => {
    if (!room || callType !== "video") return;
    try {
      await room.localParticipant.setCameraEnabled(!cameraOn);
      setCameraOn((value) => !value);
    } catch {
      setError("Kamera tidak dapat diaktifkan. Periksa izin browser.");
    }
  };

  return <div className="call-backdrop">
    <section className="call-panel" role="dialog" aria-modal="true" aria-label="DrewMingle call">
      <div className="call-panel-head">
        <div><h2>{callType === "video" ? "Video hangout" : "Voice hangout"}</h2><p>Ruang pribadi · Undangan diperlukan</p></div>
        <span className="call-state">{joining ? "Connecting..." : connected ? "Connected" : "Disconnected"}</span>
      </div>
      {error ? <div className="call-error">{error}</div> : joining ? <div className="call-waiting">Menghubungkan ke ruang panggilan...</div> : remoteMedia.some((item) => item.track.kind === Track.Kind.Video)
        ? <div className="call-video-grid">{remoteMedia.filter((item) => item.track.kind === Track.Kind.Video).map((item) => <RemoteMedia key={item.id} item={item} />)}</div>
        : <div className="call-waiting">{connected ? "Menunggu teman bergabung. Suara dan kamera masih nonaktif sampai kamu menyalakannya." : "Panggilan belum terhubung."}</div>}
      {remoteMedia.filter((item) => item.track.kind === Track.Kind.Audio).map((item) => <RemoteMedia key={item.id} item={item} />)}
      <div className="call-controls">
        <button className={micOn ? "active" : ""} onClick={() => void toggleMic()} disabled={!connected}>{micOn ? <Mic size={16} /> : <MicOff size={16} />}{micOn ? "Mute" : "Unmute"}</button>
        {callType === "video" && <button className={cameraOn ? "active" : ""} onClick={() => void toggleCamera()} disabled={!connected}>{cameraOn ? <Camera size={16} /> : <CameraOff size={16} />}{cameraOn ? "Camera off" : "Camera on"}</button>}
        <button className="end-call" onClick={onLeave}><PhoneOff size={16} /> Leave call</button>
      </div>
      <p className="call-warning">Kamera dan mikrofon nonaktif secara default. Aktifkan hanya jika kamu nyaman. Jangan merekam atau membagikan tampilan panggilan tanpa persetujuan semua peserta.</p>
    </section>
  </div>;
}

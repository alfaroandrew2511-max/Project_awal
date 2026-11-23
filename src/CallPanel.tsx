import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Camera, CameraOff, PhoneOff } from "lucide-react";
import { supabase } from "./supabase";

type CallPanelProps = {
  callRoomId: string;
  callType: "voice" | "video";
  nickname: string;
  peerId: string;
  isHost: boolean;
  onLeave: () => void;
};

type SignalRow = {
  id: string;
  room_id: string;
  sender_id: string;
  signal_type: "ready" | "offer" | "answer" | "ice" | "hangup";
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit | null;
};

export function CallPanel({ callRoomId, callType, nickname, peerId, isHost, onLeave }: CallPanelProps) {
  const [uid, setUid] = useState("");
  const [callReady, setCallReady] = useState(!isHost);
  const [connected, setConnected] = useState(false);
  const [connectionLabel, setConnectionLabel] = useState("Connecting...");
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const offerStartedRef = useRef(false);
  const signalChannelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      if (!supabase) {
        setError("Sesi DrewMingle tidak tersedia. Muat ulang halaman.");
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setUid(data.session?.user.id ?? "");
    };
    void loadSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!supabase || !uid || !isHost) return;
    const client = supabase;
    let active = true;
    const checkAccepted = async () => {
      const { data } = await client.from("drewmingle_call_invites")
        .select("id,status").eq("room_id", callRoomId).eq("invitee_id", peerId)
        .eq("status", "accepted").maybeSingle();
      if (active && data) setCallReady(true);
    };
    void checkAccepted();
    const channel = client.channel("call-acceptance-" + callRoomId)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "drewmingle_call_invites",
        filter: "room_id=eq." + callRoomId,
      }, (payload) => {
        const invite = payload.new as { invitee_id: string; status: string };
        if (invite.invitee_id === peerId && invite.status === "accepted") setCallReady(true);
        if (invite.invitee_id === peerId && invite.status === "declined") {
          setError("Undangan tidak diterima.");
          setConnectionLabel("Invitation declined");
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void checkAccepted();
      });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [uid, callRoomId, peerId, isHost]);

  useEffect(() => {
    if (!supabase || !uid || !peerId || !callReady) return;
    const client = supabase;
    let disposed = false;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peerRef.current = pc;
    audioSenderRef.current = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
    videoSenderRef.current = pc.addTransceiver("video", { direction: "sendrecv" }).sender;

    const sendSignal = async (signalType: SignalRow["signal_type"], payload: SignalRow["payload"] = null) => {
      if (!supabase || disposed) return;
      const { error: sendError } = await client.from("drewmingle_call_signals").insert({
        room_id: callRoomId, sender_id: uid, recipient_id: peerId,
        signal_type: signalType, payload,
      });
      if (sendError && !disposed) setError("Sinyal panggilan gagal dikirim. Periksa koneksi lalu coba lagi.");
    };

    const flushIce = async () => {
      if (!pc.remoteDescription) return;
      const pending = pendingIceRef.current.splice(0);
      for (const candidate of pending) {
        try { await pc.addIceCandidate(candidate); } catch { /* Ignore stale ICE candidates. */ }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal("ice", event.candidate.toJSON());
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      if (disposed) return;
      const state = pc.connectionState;
      setConnected(state === "connected");
      setConnectionLabel(state === "connected" ? "Connected" : state === "connecting" ? "Connecting..." : state === "failed" ? "Network unavailable" : state === "disconnected" ? "Disconnected" : state);
      if (state === "failed") setError("Koneksi langsung tidak berhasil di jaringan ini. Coba jaringan lain; jaringan tertentu memerlukan layanan TURN.");
    };

    const channel = client.channel("call-signals-" + callRoomId + "-" + uid)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "drewmingle_call_signals",
        filter: "recipient_id=eq." + uid,
      }, async (payload) => {
        const signal = payload.new as SignalRow;
        if (signal.room_id && signal.sender_id !== peerId) return;
        try {
          if (signal.signal_type === "ready" && isHost && !offerStartedRef.current) {
            offerStartedRef.current = true;
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendSignal("offer", offer);
          } else if (signal.signal_type === "offer" && !isHost && signal.payload) {
            await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
            await flushIce();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal("answer", answer);
          } else if (signal.signal_type === "answer" && isHost && signal.payload) {
            await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
            await flushIce();
          } else if (signal.signal_type === "ice" && signal.payload) {
            const candidate = signal.payload as RTCIceCandidateInit;
            if (pc.remoteDescription) {
              try { await pc.addIceCandidate(candidate); } catch { /* Ignore candidates from stale sessions. */ }
            } else {
              pendingIceRef.current.push(candidate);
            }
          } else if (signal.signal_type === "hangup" && !endedRef.current) {
            setConnectionLabel("Call ended");
            endedRef.current = true;
            onLeave();
          }
        } catch {
          if (!disposed) setError("Negosiasi panggilan gagal. Coba keluar lalu undang kembali.");
        }
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "drewmingle_call_rooms",
        filter: "id=eq." + callRoomId,
      }, (payload) => {
        const updatedRoom = payload.new as { status: string };
        if (updatedRoom.status === "ended" && !endedRef.current) {
          endedRef.current = true;
          onLeave();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void sendSignal("ready");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("Koneksi sinyal gagal. Muat ulang halaman.");
      });
    signalChannelRef.current = channel;

    return () => {
      disposed = true;
      void client.removeChannel(channel);
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      peerRef.current = null;
      localStream?.getTracks().forEach((track) => track.stop());
      audioTrackRef.current?.stop();
      videoTrackRef.current?.stop();
    };
  // localStream is deliberately excluded: changing a preview must not reconnect the call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, peerId, callReady, callRoomId, isHost]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const enableMedia = async (kind: "audio" | "video") => {
    const pc = peerRef.current;
    if (!pc) return;
    try {
      const existing = kind === "audio" ? audioTrackRef.current : videoTrackRef.current;
      if (existing) {
        existing.enabled = true;
      } else {
        const stream = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: true } : { video: true });
        const track = stream.getTracks()[0];
        if (kind === "audio") {
          audioTrackRef.current = track;
          await audioSenderRef.current?.replaceTrack(track);
        } else {
          videoTrackRef.current = track;
          await videoSenderRef.current?.replaceTrack(track);
        }
        setLocalStream((current) => new MediaStream([...(current?.getTracks() ?? []).filter((item) => item.kind !== kind), track]));
      }
      if (kind === "audio") setMicOn(true);
      else setCameraOn(true);
    } catch {
      setError(kind === "audio" ? "Mikrofon tidak dapat diaktifkan. Periksa izin browser." : "Kamera tidak dapat diaktifkan. Periksa izin browser.");
    }
  };

  const toggleMic = async () => {
    if (micOn) {
      if (audioTrackRef.current) audioTrackRef.current.enabled = false;
      setMicOn(false);
    } else {
      await enableMedia("audio");
    }
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      if (videoTrackRef.current) videoTrackRef.current.enabled = false;
      setCameraOn(false);
    } else {
      await enableMedia("video");
    }
  };

  const leave = async () => {
    try {
      if (!endedRef.current && supabase && uid && peerId) {
        await supabase.from("drewmingle_call_signals").insert({
          room_id: callRoomId, sender_id: uid, recipient_id: peerId,
          signal_type: "hangup", payload: null,
        });
      }
    } finally {
      endedRef.current = true;
      onLeave();
    }
  };

  const remoteHasVideo = !!remoteStream?.getVideoTracks().length;

  return <div className="call-backdrop">
    <section className="call-panel" role="dialog" aria-modal="true" aria-label="DrewMingle call">
      <div className="call-panel-head">
        <div><h2>{callType === "video" ? "Video hangout" : "Voice hangout"}</h2><p>Undangan diterima · Panggilan pribadi</p></div>
        <span className="call-state">{connectionLabel}</span>
      </div>
      {!callReady ? <div className="call-waiting">Menunggu teman menerima undangan...</div> : error ? <div className="call-error">{error}</div> : remoteHasVideo
        ? <div className="call-video-grid">
            <div className="call-video-tile"><video ref={remoteVideoRef} autoPlay playsInline /><span className="call-video-name">Teman</span></div>
            {cameraOn && <div className="call-video-tile"><video ref={localVideoRef} autoPlay muted playsInline /><span className="call-video-name">{nickname} (You)</span></div>}
          </div>
        : <div className="call-waiting">{connected ? "Panggilan tersambung. Suara dan kamera masih nonaktif sampai kamu menyalakannya." : "Menghubungkan ke teman. Pastikan keduanya memakai jaringan yang mendukung koneksi langsung."}</div>}
      {remoteStream && !remoteHasVideo && <audio ref={remoteAudioRef} autoPlay />}
      <div className="call-controls">
        <button className={micOn ? "active" : ""} onClick={() => void toggleMic()} disabled={!callReady}>{micOn ? <Mic size={16} /> : <MicOff size={16} />}{micOn ? "Mute" : "Unmute"}</button>
        {callType === "video" && <button className={cameraOn ? "active" : ""} onClick={() => void toggleCamera()} disabled={!callReady}>{cameraOn ? <Camera size={16} /> : <CameraOff size={16} />}{cameraOn ? "Camera off" : "Camera on"}</button>}
        <button className="end-call" onClick={() => void leave()}><PhoneOff size={16} /> Leave call</button>
      </div>
      <p className="call-warning">Mikrofon dan kamera nonaktif secara default. Koneksi peer-to-peer dapat memperlihatkan alamat IP jaringan kepada peserta lain. Jangan panggilan dengan orang yang tidak kamu kenal atau percayai.</p>
    </section>
  </div>;
}

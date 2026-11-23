import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight, Globe2, Hash, MessageCircle, Send, ShieldCheck,
  Users, Wifi, X, Flag, Sparkles, ChevronDown, CircleHelp, Moon, Sun, Reply, BellRing, Phone, Video
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseReady } from "./supabase";
import { CallPanel } from "./CallPanel";

type Country = { id: string; label: string; flag: string };
type ChatMessage = { id: string; user_id: string; nickname: string; content: string; created_at: string; reply_to_id: string | null };
type OnlineMember = { user_id: string; nickname: string };
type CallType = "voice" | "video";
type ActiveCall = { roomId: string; callType: CallType; hostId: string; peerId: string };
type IncomingInvite = { id: string; room_id: string; inviter_id: string; callType: CallType };
const countries: Country[] = [
  { id: "global", label: "Global", flag: "🌐" },
  { id: "id", label: "Indonesia", flag: "🇮🇩" },
  { id: "jp", label: "Japan", flag: "🇯🇵" },
  { id: "kr", label: "South Korea", flag: "🇰🇷" },
  { id: "us", label: "United States", flag: "🇺🇸" },
  { id: "gb", label: "United Kingdom", flag: "🇬🇧" },
  { id: "de", label: "Germany", flag: "🇩🇪" },
  { id: "br", label: "Brazil", flag: "🇧🇷" },
];
const topics = ["General", "Music", "Games", "Technology", "Movies", "Language exchange"];
const blockedWords = ["kontol", "memek", "anjing", "bangsat", "nigger", "fuck", "bitch"];
const makeName = () =>
  ["Misty", "Cosmic", "Quiet", "Nova", "Pixel", "Sunny", "Echo"][Math.floor(Math.random() * 7)] +
  " " + Math.floor(100 + Math.random() * 900);
const roomId = (country: string, topic: string) =>
  country + "_" + topic.toLowerCase().replaceAll(" ", "_");
const cleanText = (value: string) => value.replace(/[<>]/g, "").trim();
const isBlocked = (value: string) => blockedWords.some((word) => value.toLowerCase().includes(word));

export default function App() {
  const [nickname, setNickname] = useState(() => window.localStorage.getItem("drewmingle-nickname") || makeName());
  const [nicknameDraft, setNicknameDraft] = useState(() => window.localStorage.getItem("drewmingle-nickname") || "");
  const [editingNickname, setEditingNickname] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => window.localStorage.getItem("drewmingle-theme") === "dark" ? "dark" : "light");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [country, setCountry] = useState("global");
  const [topic, setTopic] = useState("General");
  const [uid, setUid] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(0);
  const [onlineMembers, setOnlineMembers] = useState<OnlineMember[]>([]);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<IncomingInvite | null>(null);
  const [sendingInvite, setSendingInvite] = useState("");
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [showSafety, setShowSafety] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRoom = useMemo(() => roomId(country, topic), [country, topic]);
  const selectedCountry = countries.find((item) => item.id === country) ?? countries[0];

  useEffect(() => { window.localStorage.setItem("drewmingle-theme", theme); }, [theme]);
  useEffect(() => { window.localStorage.setItem("drewmingle-nickname", nickname); }, [nickname]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let mounted = true;
    const start = async () => {
      const { data, error } = await client.auth.getSession();
      if (error) {
        if (mounted) setNotice("Tidak dapat memeriksa sesi. Muat ulang halaman.");
        return;
      }
      if (data.session?.user) {
        if (mounted) { setUid(data.session.user.id); setAuthReady(true); }
        return;
      }
      const { data: signInData, error: signInError } = await client.auth.signInAnonymously();
      if (signInError) {
        if (mounted) setNotice("Aktifkan Anonymous Sign-Ins di Supabase Authentication untuk menghubungkan chat.");
        return;
      }
      if (mounted && signInData.user) {
        setUid(signInData.user.id);
        setAuthReady(true);
      }
    };
    void start();
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session?.user) { setUid(session.user.id); setAuthReady(true); }
      else { setUid(""); setAuthReady(false); }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !uid) return;
    let active = true;
    let channel: RealtimeChannel | null = null;
    setConnected(false);
    setMessages([]);
    setOnline(0);
    setOnlineMembers([]);

    const loadMessages = async () => {
      const { data, error } = await client
        .from("drewmingle_messages")
        .select("id,user_id,nickname,content,created_at,reply_to_id")
        .eq("room_slug", activeRoom)
        .order("created_at", { ascending: true })
        .limit(100);
      if (!active) return;
      if (error) setNotice("Pesan belum dapat dimuat. Periksa pengaturan Authentication dan RLS.");
      else setMessages((data ?? []) as ChatMessage[]);
    };
    void loadMessages();

    channel = client.channel("drewmingle:" + activeRoom, {
      config: { presence: { key: uid } },
    });
    channel
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "drewmingle_messages",
        filter: "room_slug=eq." + activeRoom,
      }, (payload) => {
        const message = payload.new as ChatMessage;
        setMessages((current) => current.some((item) => item.id === message.id)
          ? current : [...current, message].slice(-100));
        if (message.user_id !== uid) {
          if ("Notification" in window && Notification.permission === "granted") {
            const notification = new Notification(`DrewMingle · ${message.nickname}`, {
              body: message.content,
              tag: `drewmingle-${message.id}`,
              icon: "/favicon.ico",
            });
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          } else {
            setNotice(`Pesan baru dari ${message.nickname}: ${message.content}`);
          }
        }
      })
      .on("presence", { event: "sync" }, () => {
        if (!channel) return;
        const state = channel.presenceState<{ user_id?: string; nickname?: string }>();
        setOnline(Object.keys(state).length);
        const members = Object.entries(state).flatMap(([key, metas]) => {
          const meta = metas[0];
          const userId = meta?.user_id ?? key;
          if (!userId || userId === uid) return [];
          return [{ user_id: userId, nickname: meta?.nickname || "DrewMingle user" }];
        });
        setOnlineMembers(members.filter((member, index, all) => all.findIndex((item) => item.user_id === member.user_id) === index));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && channel) {
          await channel.track({ user_id: uid, nickname, joined_at: new Date().toISOString() });
          if (active) setConnected(true);
        }
      });

    return () => {
      active = false;
      if (channel && supabase) void client.removeChannel(channel);
    };
  }, [uid, activeRoom, nickname]);


  useEffect(() => {
    const client = supabase;
    if (!client || !uid) return;
    let active = true;
    const showInvite = async (invite: { id: string; room_id: string; inviter_id: string }) => {
      const { data: room } = await client.from("drewmingle_call_rooms")
        .select("call_type,status,expires_at").eq("id", invite.room_id).maybeSingle();
      if (!active || !room || room.status !== "active" || new Date(room.expires_at).getTime() < Date.now()) return;
      setIncomingInvite({ ...invite, callType: room.call_type as CallType });
    };
    const channel = client.channel("drewmingle-call-invites:" + uid)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "drewmingle_call_invites",
        filter: "invitee_id=eq." + uid,
      }, (payload) => {
        const invite = payload.new as { id: string; room_id: string; inviter_id: string; status: string };
        if (invite.status === "pending") void showInvite(invite);
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "drewmingle_call_invites",
        filter: "inviter_id=eq." + uid,
      }, (payload) => {
        const invite = payload.new as { status: string };
        if (invite.status === "accepted") setNotice("Undangan diterima. Temanmu sudah masuk ke ruang panggilan.");
        if (invite.status === "declined") setNotice("Undangan panggilan tidak diterima.");
      })
      .subscribe();
    void client.from("drewmingle_call_invites")
      .select("id,room_id,inviter_id,status")
      .eq("invitee_id", uid).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(3)
      .then(({ data }) => {
        if (active && data?.[0]) void showInvite(data[0]);
      });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [uid]);

  const inviteToCall = async (member: OnlineMember, callType: CallType) => {
    if (!supabase || !uid || sendingInvite) return;
    setSendingInvite(member.user_id);
    const { data: room, error: roomError } = await supabase
      .from("drewmingle_call_rooms")
      .insert({ host_id: uid, call_type: callType })
      .select("id").single();
    if (roomError || !room) {
      setNotice("Ruang panggilan gagal dibuat. Coba lagi.");
      setSendingInvite("");
      return;
    }
    const { error: inviteError } = await supabase.from("drewmingle_call_invites").insert({
      room_id: room.id, inviter_id: uid, invitee_id: member.user_id, status: "pending",
    });
    if (inviteError) {
      await supabase.from("drewmingle_call_rooms").update({ status: "ended" }).eq("id", room.id);
      setNotice("Undangan gagal dikirim. Pengguna mungkin sudah tidak online.");
    } else {
      setActiveCall({ roomId: room.id, callType, hostId: uid, peerId: member.user_id });
      setNotice("Undangan dikirim kepada " + member.nickname + ". Tunggu persetujuannya.");
    }
    setSendingInvite("");
  };

  const respondToInvite = async (accept: boolean) => {
    if (!supabase || !incomingInvite) return;
    const invite = incomingInvite;
    const { error } = await supabase.from("drewmingle_call_invites").update({
      status: accept ? "accepted" : "declined",
      responded_at: new Date().toISOString(),
    }).eq("id", invite.id).eq("invitee_id", uid);
    if (error) {
      setNotice("Respons undangan gagal dikirim. Coba muat ulang.");
    } else if (accept) {
      setActiveCall({ roomId: invite.room_id, callType: invite.callType, hostId: invite.inviter_id, peerId: invite.inviter_id });
    }
    setIncomingInvite(null);
  };

  const leaveCall = async () => {
    if (supabase && activeCall?.hostId === uid) {
      await supabase.from("drewmingle_call_rooms").update({ status: "ended" })
        .eq("id", activeCall.roomId).eq("host_id", uid);
    }
    setActiveCall(null);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      setNotice("Browser ini belum mendukung notifikasi. Coba gunakan Chrome versi terbaru.");
      return;
    }
    if (!window.isSecureContext) {
      setNotice("Notifikasi membutuhkan koneksi HTTPS.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setNotice(permission === "granted"
      ? "Notifikasi DrewMingle berhasil diaktifkan."
      : "Izin notifikasi belum diberikan. Ubah izin situs melalui pengaturan browser.");
  };

  const sendMessage = async () => {
    const content = cleanText(draft);
    if (!content || !uid || !supabase || busy || !connected) return;
    if (content.length > 400) { setNotice("Pesan maksimal 400 karakter."); return; }
    if (isBlocked(content)) {
      setNotice("Pesan tidak terkirim karena mengandung kata yang tidak pantas.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("drewmingle_messages").insert({
      room_slug: activeRoom, user_id: uid, nickname, content, reply_to_id: replyingTo?.id ?? null,
    });
    if (error) setNotice("Pesan gagal dikirim. Periksa koneksi atau coba lagi.");
    else { setDraft(""); setReplyingTo(null); setNotice(""); }
    setBusy(false);
  };

  const reportMessage = async (message: ChatMessage) => {
    if (!uid || !supabase || message.user_id === uid) return;
    const { error } = await supabase.from("drewmingle_reports").insert({
      room_slug: activeRoom, message_id: message.id, reporter_id: uid, reason: "Other",
    });
    setNotice(error
      ? "Laporan gagal dikirim atau pesan ini sudah pernah kamu laporkan."
      : "Laporan tercatat. Terima kasih telah menjaga ruang ini.");
  };

  const changeRoom = (nextCountry: string, nextTopic: string) => {
    setCountry(nextCountry);
    setTopic(nextTopic);
    setNotice("");
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark"><MessageCircle size={19} /></span><span>Drew<span className="brand-accent">Mingle</span></span></a>
        <div className="topbar-right">
          <span className="status-pill"><i className={connected ? "status-dot live" : "status-dot"} />{connected ? "Connected" : supabaseReady ? "Connecting" : "Setup needed"}</span>
          <button className="icon-button" onClick={() => void enableNotifications()} aria-label="Enable chat notifications" title={notificationPermission === "granted" ? "Notifications enabled" : "Enable notifications"}><BellRing size={17} /></button>
          <button className="icon-button" onClick={() => setTheme((current) => current === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Enable dark mode" : "Enable light mode"} title={theme === "light" ? "Dark mode" : "Light mode"}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button className="icon-button" onClick={() => setShowSafety(true)} aria-label="Safety information"><ShieldCheck size={18} /></button>
        </div>
      </header>

      <main className="layout">
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-line" /> COMMUNITY CHAT, WITHOUT BORDERS</div>
          <h1>Talk with<br /><span>the world.</span></h1>
          <p className="intro-copy">Satu ruang publik untuk berbagi ide dan berbincang dengan komunitas dari berbagai negara.</p>
          <div className="intro-stats">
            <div><strong><Globe2 size={16} /> 8</strong><span>Regions</span></div>
            <div><strong><Users size={16} /> {online}</strong><span>In this room</span></div>
            <div><strong><Wifi size={16} /> Live</strong><span>Realtime chat</span></div>
          </div>
          <div className="safety-note"><ShieldCheck size={16} /><span>Ruang publik berbasis topik. Jangan bagikan data pribadi.</span></div>
        </section>

        <section className="chat-card">
          <div className="chat-heading">
            <div><div className="chat-kicker">YOUR COMMUNITY</div><h2>Explore a room</h2></div>
            <span className="room-live"><span /> PUBLIC ROOM</span>
          </div>

          <div className="filters">
            <label className="field-label">REGION</label>
            <div className="country-select-wrap">
              <select value={country} onChange={(event) => changeRoom(event.target.value, topic)} aria-label="Choose region">
                {countries.map((item) => <option key={item.id} value={item.id}>{item.flag}  {item.label}</option>)}
              </select><ChevronDown size={15} />
            </div>
            <label className="field-label topic-label">TOPIC</label>
            <div className="topic-list">
              {topics.map((item) => <button key={item} className={topic === item ? "topic-chip active" : "topic-chip"} onClick={() => changeRoom(country, item)}><Hash size={12} />{item}</button>)}
            </div>
          </div>

          <div className="room-banner">
            <div className="room-icon">{selectedCountry.flag}</div>
            <div className="room-info"><strong>{selectedCountry.label} · {topic}</strong><span>Open community conversation</span></div>
            <span className="member-count"><Users size={14} /> {online}</span>
          </div>


          <div className="hangout-panel">
            <div className="hangout-heading">
              <div><strong>Hangout with someone online</strong><span>Undang orang yang kamu kenal dan percaya.</span></div>
              <span className="hangout-count">{onlineMembers.length} online</span>
            </div>
            {onlineMembers.length ? <div className="hangout-members">
              {onlineMembers.map((member) => <div className="hangout-member" key={member.user_id}>
                <span className="member-avatar">{member.nickname.slice(0, 1).toUpperCase()}</span>
                <strong>{member.nickname}</strong>
                <div className="hangout-actions">
                  <button disabled={!!sendingInvite || !!activeCall} onClick={() => void inviteToCall(member, "voice")} title="Invite to voice call"><Phone size={13} /> Voice</button>
                  <button disabled={!!sendingInvite || !!activeCall} onClick={() => void inviteToCall(member, "video")} title="Invite to video call"><Video size={13} /> Video</button>
                </div>
              </div>)}
            </div> : <p className="hangout-empty">Belum ada pengguna lain di ruang ini. Pengguna yang online di ruang yang sama akan muncul di sini.</p>}
            <p className="hangout-safety">Panggilan hanya dimulai setelah undangan diterima. Mikrofon dan kamera nonaktif secara default.</p>
          </div>

          <div className="message-area">
            {!supabaseReady ? (
              <div className="setup-state"><div className="setup-icon"><Sparkles size={22} /></div><h3>Chat belum diaktifkan</h3><p>Konfigurasi Supabase belum tersedia. Aplikasi membutuhkan URL proyek dan publishable key agar dapat terhubung.</p><span className="setup-tag">SUPABASE CONFIGURATION REQUIRED</span></div>
            ) : !authReady ? (
              <div className="setup-state"><div className="setup-icon"><ShieldCheck size={22} /></div><h3>Menyiapkan koneksi aman</h3><p>Jika ini terus muncul, aktifkan Anonymous Sign-Ins pada pengaturan Authentication proyek Supabase.</p><span className="setup-tag">AUTHENTICATION REQUIRED</span></div>
            ) : !messages.length ? (
              <div className="empty-state"><div className="empty-orbit"><MessageCircle size={23} /></div><h3>Start the conversation</h3><p>Belum ada pesan di sini. Mulailah dengan sapaan sederhana.</p><span className="icebreaker" onClick={() => setDraft("Hi! What are you interested in lately?")}>“Hi! What are you interested in lately?” <ArrowUpRight size={13} /></span></div>
            ) : (
              <div className="messages-list">
                {messages.map((message) => <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={message.user_id === uid ? "message own" : "message"} key={message.id}>
                  <div className="avatar">{message.nickname.slice(0, 1).toUpperCase()}</div>
                  <div className="message-content"><div className="message-meta"><strong>{message.user_id === uid ? "You" : message.nickname}</strong><time>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><button className="report-button reply-action" onClick={() => setReplyingTo(message)} title="Reply to message"><Reply size={13} /></button>{message.user_id !== uid && <button className="report-button" onClick={() => void reportMessage(message)} title="Report message"><Flag size={12} /></button>}</div>{message.reply_to_id && <div className="reply-quote">{(() => { const parent = messages.find((item) => item.id === message.reply_to_id); return parent ? <><strong>{parent.nickname}</strong><span>{parent.content}</span></> : <span>Reply to an earlier message</span>; })()}</div>}<p>{message.content}</p></div>
                </motion.article>)}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="composer">
            <div className="nickname-line"><span className="avatar-mini">{nickname.slice(0, 1).toUpperCase()}</span>{editingNickname ? <><input className="nickname-input" value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value.slice(0, 24))} maxLength={24} placeholder="Your nickname" /><button onClick={() => { const next = cleanText(nicknameDraft); if (next.length < 3) { setNotice("Nama harus terdiri dari 3–24 karakter."); return; } setNickname(next); setEditingNickname(false); setNotice("Nama berhasil diperbarui."); }}>Save</button><button onClick={() => setEditingNickname(false)}>Cancel</button></> : <><span>Chatting as <strong>{nickname}</strong></span><button onClick={() => { setNicknameDraft(nickname); setEditingNickname(true); }}>Edit name</button><button onClick={() => { const next = makeName(); setNickname(next); setNicknameDraft(next); }}>Random</button></>}</div>
            {replyingTo && <div className="reply-composer"><div><strong>Replying to {replyingTo.nickname}</strong><span>{replyingTo.content}</span></div><button onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
            <div className="compose-row">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} maxLength={400} placeholder={connected ? "Write something kind..." : "Connecting to public room..."} disabled={!connected} />
              <button className="send-button" onClick={() => void sendMessage()} disabled={!connected || !draft.trim() || busy} aria-label="Send message"><Send size={17} /></button>
            </div>
            <div className="composer-foot"><span><ShieldCheck size={12} /> Keep it respectful. No personal information.</span><span>{draft.length}/400</span></div>
          </div>
          <AnimatePresence>{notice && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="toast"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14} /></button></motion.div>}</AnimatePresence>
        </section>
      </main>

      {incomingInvite && <div className="call-backdrop">
        <div className="invite-modal">
          <div className="call-modal-icon">{incomingInvite.callType === "video" ? <Video size={22} /> : <Phone size={22} />}</div>
          <span className="call-kicker">INCOMING INVITATION</span>
          <h3>Someone invited you</h3>
          <p>Undangan panggilan {incomingInvite.callType === "video" ? "video" : "suara"} dari pengguna DrewMingle. Terima hanya jika kamu mengenal dan memercayai orang tersebut.</p>
          <div className="invite-actions">
            <button className="invite-decline" onClick={() => void respondToInvite(false)}>Decline</button>
            <button className="invite-accept" onClick={() => void respondToInvite(true)}>Accept invitation</button>
          </div>
        </div>
      </div>}
      {activeCall && <CallPanel callRoomId={activeCall.roomId} callType={activeCall.callType} nickname={nickname} peerId={activeCall.peerId} isHost={activeCall.hostId === uid} onLeave={() => void leaveCall()} />}
      <footer className="footer"><span>© 2026 DrewMingle</span><span>Meet ideas, not expectations.</span><button onClick={() => setShowSafety(true)}><CircleHelp size={13} /> Safety guidelines</button></footer>

      <AnimatePresence>{showSafety && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSafety(false)}><motion.div className="safety-modal" initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} onClick={(event) => event.stopPropagation()}><div className="modal-top"><span className="modal-icon"><ShieldCheck size={20} /></span><button className="icon-button" onClick={() => setShowSafety(false)}><X size={17} /></button></div><h3>Keep the conversation safe.</h3><p>DrewMingle adalah ruang obrolan publik berbasis topik, bukan tempat untuk membagikan informasi pribadi.</p><ul><li>Jangan bagikan nama lengkap, alamat, sekolah, nomor telepon, atau akun pribadi.</li><li>Jangan pindah ke percakapan privat dengan orang yang baru dikenal.</li><li>Laporkan pesan yang melecehkan, mengancam, atau meminta informasi pribadi.</li><li>Keluar dari ruang jika percakapan membuat Anda tidak nyaman.</li></ul><button className="modal-done" onClick={() => setShowSafety(false)}>I understand</button></motion.div></motion.div>}</AnimatePresence>
    </div>
  );
}

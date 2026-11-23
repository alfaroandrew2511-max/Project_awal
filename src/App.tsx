import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight, Globe2, Hash, MessageCircle, Send, ShieldCheck,
  Users, Wifi, X, Flag, Sparkles, ChevronDown, CircleHelp
} from "lucide-react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  onChildAdded, onValue, onDisconnect, push, ref, remove, serverTimestamp, set
} from "firebase/database";
import { auth, database, firebaseReady } from "./firebase";

type Country = { id: string; label: string; flag: string };
type ChatMessage = { id: string; uid: string; name: string; text: string; createdAt: number };
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
const safeWords = ["bodoh", "anjing", "kontol", "memek", "bangsat", "bitch", "fuck", "nigger"];
const makeName = () => ["Misty", "Cosmic", "Quiet", "Nova", "Pixel", "Sunny", "Echo"][Math.floor(Math.random() * 7)] + " " + Math.floor(100 + Math.random() * 900);
const roomId = (country: string, topic: string) => country + "_" + topic.toLowerCase().replaceAll(" ", "_");
const cleanText = (value: string) => value.replace(/[<>]/g, "").trim();

export default function App() {
  const [nickname, setNickname] = useState(makeName);
  const [country, setCountry] = useState("global");
  const [topic, setTopic] = useState("General");
  const [uid, setUid] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(0);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [showSafety, setShowSafety] = useState(false);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRoom = useMemo(() => roomId(country, topic), [country, topic]);
  const selectedCountry = countries.find((item) => item.id === country) ?? countries[0];

  useEffect(() => {
    if (!firebaseReady || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) setUid(user.uid);
      else {
        try { await signInAnonymously(auth); }
        catch { setNotice("Autentikasi belum aktif. Periksa konfigurasi Firebase."); }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!uid || !database) return;
    setConnected(false);
    setMessages([]);
    const roomRef = ref(database, `rooms/${activeRoom}`);
    const messagesRef = ref(database, `rooms/${activeRoom}/messages`);
    const presenceRef = ref(database, `rooms/${activeRoom}/presence/${uid}`);
    const unsubMessages = onChildAdded(messagesRef, (snapshot) => {
      const value = snapshot.val();
      if (!value) return;
      setMessages((current) => current.some((item) => item.id === snapshot.key) ? current : [...current, {
        id: snapshot.key ?? crypto.randomUUID(),
        uid: value.uid,
        name: value.name,
        text: value.text,
        createdAt: value.createdAt ?? Date.now(),
      }].slice(-100));
    });
    const unsubPresence = onValue(ref(database, `rooms/${activeRoom}/presence`), (snapshot) => {
      setOnline(snapshot.exists() ? Object.keys(snapshot.val()).length : 0);
    });
    set(presenceRef, { name: nickname, lastSeen: Date.now() }).then(() => {
      onDisconnect(presenceRef).remove();
      setConnected(true);
    }).catch(() => setNotice("Tidak dapat masuk ke ruang ini. Periksa aturan database."));
    return () => {
      unsubMessages();
      unsubPresence();
      void remove(presenceRef);
      void roomRef;
    };
  }, [uid, activeRoom, nickname]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    const text = cleanText(draft);
    if (!text || !uid || !database || busy) return;
    if (text.length > 400) { setNotice("Pesan maksimal 400 karakter."); return; }
    if (safeWords.some((word) => text.toLowerCase().includes(word))) {
      setNotice("Pesan tidak terkirim karena terdeteksi kata yang tidak pantas.");
      return;
    }
    setBusy(true);
    try {
      await push(ref(database, `rooms/${activeRoom}/messages`), {
        uid, name: nickname, text, createdAt: Date.now(),
      });
      setDraft("");
      setNotice("");
    } catch {
      setNotice("Pesan gagal dikirim. Periksa koneksi dan aturan Firebase.");
    } finally { setBusy(false); }
  };

  const reportMessage = async (message: ChatMessage) => {
    if (!uid || !database || message.uid === uid) return;
    const reportRef = push(ref(database, `rooms/${activeRoom}/reports`));
    try {
      await set(reportRef, {
        reporterUid: uid, messageId: message.id, reason: "Pesan tidak pantas", createdAt: Date.now(),
      });
      setNotice("Laporan tercatat. Terima kasih telah menjaga ruang ini.");
    } catch { setNotice("Laporan gagal dikirim."); }
  };

  const changeRoom = (nextCountry: string, nextTopic: string) => {
    setCountry(nextCountry);
    setTopic(nextTopic);
    setNotice("");
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark"><MessageCircle size={19} /></span><span>Drew<span className="brand-accent">Mingle</span></span></a>
        <div className="topbar-right">
          <span className="status-pill"><i className={connected ? "status-dot live" : "status-dot"} />{connected ? "Connected" : "Connecting"}</span>
          <button className="icon-button" onClick={() => setShowSafety(true)} aria-label="Safety information"><ShieldCheck size={18} /></button>
        </div>
      </header>

      <main className="layout">
        <section className="intro">
          <div className="eyebrow"><span className="eyebrow-line" /> COMMUNITY CHAT, WITHOUT BORDERS</div>
          <h1>Small talk.<br /><span>Big world.</span></h1>
          <p className="intro-copy">Temukan percakapan baru, bertukar ide, dan belajar hal menarik dari komunitas lintas negara.</p>
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
            <span className="room-live"><span /> LIVE ROOM</span>
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

          <div className="message-area">
            {!firebaseReady ? (
              <div className="setup-state"><div className="setup-icon"><Sparkles size={22} /></div><h3>One quick setup left</h3><p>Firebase belum dihubungkan. Tambahkan konfigurasi Firebase agar ruang chat dapat menerima pesan secara langsung.</p><span className="setup-tag">WAITING FOR FIREBASE CONFIG</span></div>
            ) : !messages.length ? (
              <div className="empty-state"><div className="empty-orbit"><MessageCircle size={23} /></div><h3>Start the conversation</h3><p>Belum ada pesan di sini. Mulailah dengan sapaan sederhana.</p><span className="icebreaker" onClick={() => setDraft("Hi! What are you interested in lately?")}>“Hi! What are you interested in lately?” <ArrowUpRight size={13} /></span></div>
            ) : (
              <div className="messages-list">
                {messages.map((message) => <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={message.uid === uid ? "message own" : "message"} key={message.id}>
                  <div className="avatar">{message.name.slice(0, 1).toUpperCase()}</div>
                  <div className="message-content"><div className="message-meta"><strong>{message.uid === uid ? "You" : message.name}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{message.uid !== uid && <button className="report-button" onClick={() => void reportMessage(message)} title="Report message"><Flag size={12} /></button>}</div><p>{message.text}</p></div>
                </motion.article>)}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="composer">
            <div className="nickname-line"><span className="avatar-mini">{nickname.slice(0, 1)}</span><span>Chatting as <strong>{nickname}</strong></span><button onClick={() => setNickname(makeName())}>Change</button></div>
            <div className="compose-row">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} maxLength={400} placeholder={firebaseReady ? "Write something kind..." : "Connect Firebase to start chatting"} disabled={!firebaseReady || !connected} />
              <button className="send-button" onClick={() => void sendMessage()} disabled={!firebaseReady || !connected || !draft.trim() || busy} aria-label="Send message"><Send size={17} /></button>
            </div>
            <div className="composer-foot"><span><ShieldCheck size={12} /> Keep it respectful. No personal information.</span><span>{draft.length}/400</span></div>
          </div>
          <AnimatePresence>{notice && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="toast"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14} /></button></motion.div>}</AnimatePresence>
        </section>
      </main>
      <footer className="footer"><span>© 2026 DrewMingle</span><span>Meet ideas, not expectations.</span><button onClick={() => setShowSafety(true)}><CircleHelp size={13} /> Safety guidelines</button></footer>

      <AnimatePresence>{showSafety && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSafety(false)}><motion.div className="safety-modal" initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} onClick={(event) => event.stopPropagation()}><div className="modal-top"><span className="modal-icon"><ShieldCheck size={20} /></span><button className="icon-button" onClick={() => setShowSafety(false)}><X size={17} /></button></div><h3>Keep the conversation safe.</h3><p>DrewMingle adalah ruang obrolan publik berbasis topik, bukan tempat untuk membagikan informasi pribadi.</p><ul><li>Jangan bagikan nama lengkap, alamat, sekolah, nomor telepon, atau akun pribadi.</li><li>Jangan pindah ke percakapan privat dengan orang yang baru dikenal.</li><li>Laporkan pesan yang melecehkan, mengancam, atau meminta informasi pribadi.</li><li>Keluar dari ruang jika percakapan membuat Anda tidak nyaman.</li></ul><button className="modal-done" onClick={() => setShowSafety(false)}>I understand</button></motion.div></motion.div>}</AnimatePresence>
    </div>
  );
}
/* global Peer, supabase, Sound, icon, hydrateIcons */
// Telao — servidores privados, amigos, DMs, chamadas, voz e transmissão de tela.
// Dados no Supabase (com segurança por linha). Voz/vídeo direto entre os PCs (PeerJS/WebRTC).

const CFG = window.TELAO_CONFIG || {};
const EMAIL_DOMAIN = 'telao.local';
const USER_RE = /^[a-z0-9_.]{3,20}$/;
const SERVER_COLORS = ['#7c5cff', '#22d3ee', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6', '#14b8a6'];
const PEER_OPTS = { debug: 1, config: { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' },
] } };
const QUALITY = {
  '720': { width: 1280, height: 720, frameRate: 30, bitrate: 2_500_000 },
  '1080': { width: 1920, height: 1080, frameRate: 30, bitrate: 4_500_000 },
  '1080-60': { width: 1920, height: 1080, frameRate: 60, bitrate: 8_000_000 },
};
const MIC_BITRATE = { max: 128000, high: 96000, mid: 64000, low: 32000 };
const SCREEN_AUDIO_BITRATE = 128000;
const IS_DESKTOP = !!window.telao; // false = versão web (navegador)
const IS_MOBILE_DEVICE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const CAN_SHARE = !!navigator.mediaDevices?.getDisplayMedia && !IS_MOBILE_DEVICE; // navegador de celular não transmite tela
const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
const DEVICE_ID = Math.random().toString(36).slice(2, 10); // identifica esta janela/aparelho
const RELEASES_URL = 'https://github.com/ErikLima173/telao-releases/releases/latest';
// Permissões dos cargos (mesmos bits usados no banco)
const PERM = { ADMIN: 1, MANAGE_SERVER: 2, MANAGE_ROLES: 4, MANAGE_CHANNELS: 8, KICK: 16, INVITE: 32, SEND: 64, MANAGE_MESSAGES: 128, CONNECT: 256, SPEAK: 512, STREAM: 1024 };
const PERM_ALL = 2047;
const PERM_INFO = [
  ['ADMIN', 'Administrador', 'Tem todas as permissões e vê todos os canais privados. Dê com cuidado.'],
  ['MANAGE_SERVER', 'Gerenciar servidor', 'Mudar o nome, o ícone e a cor do servidor.'],
  ['MANAGE_ROLES', 'Gerenciar cargos', 'Criar e editar cargos abaixo do seu e dá-los aos membros.'],
  ['MANAGE_CHANNELS', 'Gerenciar canais', 'Criar, renomear, apagar canais e torná-los privados.'],
  ['KICK', 'Expulsar membros', 'Remover do servidor quem tem cargo abaixo do seu.'],
  ['INVITE', 'Convidar amigos', 'Convidar amigos para o servidor.'],
  ['SEND', 'Enviar mensagens', 'Escrever nos canais de texto.'],
  ['MANAGE_MESSAGES', 'Gerenciar mensagens', 'Apagar mensagens de outras pessoas.'],
  ['CONNECT', 'Conectar', 'Entrar nos canais de voz.'],
  ['SPEAK', 'Falar', 'Usar o microfone nos canais de voz.'],
  ['STREAM', 'Transmitir tela', 'Transmitir a tela nos canais de voz.'],
];
const ROLE_COLORS = ['#99aab5', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#7c5cff', '#22d3ee', '#ff73fa'];
const STATUS_TEXT = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe', offline: 'Offline', invisible: 'Invisível' };

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function setIcon(btn, name) { btn.replaceChildren(icon(name)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = {
  sb: null, user: null, me: null, peer: null, peerId: null,
  profiles: new Map(), online: new Map(), onlineSubs: new Map(), myOnline: null,
  myStatus: store.get('telao-status', 'online'),
  friendships: [], invites: [], servers: [],
  mode: 'home', server: null, channels: [], members: [], viewCh: null, textCh: null, ftab: 'online',
  dms: new Map(), chanServer: new Map(), unread: new Set(),
  presence: new Map(), typing: new Map(), lastTypingSent: 0,
  voice: null, deaf: false, pubs: {}, remote: new Map(), analysers: new Map(), prevVoiceIds: new Set(),
  roles: [], memberRoles: new Map(), hiddenDMs: new Map(), prevLive: new Set(), lateMsgs: [], watching: new Set(), liveStart: 0, rewatch: new Map(),
  call: null, incoming: null, showMembers: store.get('telao-members', window.innerWidth > 1180),
  audioPrefs: Object.assign({ in: '', out: '', ns: true, ec: true, agc: true, quality: 'high' }, store.get('telao-audio', {})),
};

// ---------- utilidades ----------
const COLORS = ['#7c5cff', '#ec4899', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#14b8a6', '#a855f7'];
function colorFor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
const initial = (n) => (String(n || '?').trim().charAt(0) || '?').toUpperCase();
function initials(name) { const w = String(name).trim().split(/\s+/).slice(0, 2); return w.map((x) => x[0] || '').join('').toUpperCase() || '?'; }
let toastTimer;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3200); }
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); if (id === 'modal-settings') stopMicTest(); if (id === 'picker') stopPicker(); }
function confirmBox(title, text, yes = 'Confirmar') {
  return new Promise((res) => {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-yes').textContent = yes;
    openModal('modal-confirm');
    const done = (v) => { closeModal('modal-confirm'); res(v); };
    $('confirm-yes').onclick = () => done(true); $('confirm-no').onclick = () => done(false);
  });
}
function wireModals() {
  document.querySelectorAll('.close-modal').forEach((b) => (b.onclick = () => closeModal(b.closest('.modal').id)));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m && m.id !== 'modal-call') closeModal(m.id); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.id !== 'modal-call' && closeModal(m.id));
  });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#server-menu, #server-head')) $('server-menu').classList.add('hidden'); });
}
function fmtTime(d) { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function fmtDay(d) {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ---------- perfis e avatares ----------
const prof = (id) => S.profiles.get(id);
const nameOf = (id) => prof(id)?.name || 'Usuário';
function cacheProfile(p) { if (p) S.profiles.set(p.id, p); }
async function ensureProfiles(ids) {
  const miss = [...new Set(ids)].filter((id) => id && !S.profiles.has(id));
  if (!miss.length) return;
  const { data } = await S.sb.from('profiles').select('*').in('id', miss);
  (data || []).forEach(cacheProfile);
}
function statusOf(id) {
  if (id === S.user?.id) return S.myStatus === 'invisible' ? 'offline' : S.myStatus;
  return S.online.get(id) || 'offline';
}
function avatar(id, size, { status = false, peer = null, fallback = null } = {}) {
  const p = prof(id); const w = el('div', 'av');
  w.style.width = w.style.height = size + 'px';
  if (p?.avatar_url) {
    const img = document.createElement('img'); img.className = 'av-img'; img.src = p.avatar_url; img.loading = 'lazy'; img.draggable = false; img.alt = '';
    w.appendChild(img);
  } else {
    const n = p?.name || fallback || '?'; const t = el('div', 'av-txt', initial(n));
    t.style.background = colorFor(id || n); t.style.fontSize = Math.round(size * 0.42) + 'px'; w.appendChild(t);
  }
  if (status) w.appendChild(el('span', 'dot ' + statusOf(id)));
  if (peer) w.dataset.peer = peer;
  w.dataset.uid = id || '';
  return w;
}
function paintServerIcon(elm, s) {
  elm.textContent = '';
  if (s.icon_url) { elm.style.background = `center / cover no-repeat url("${s.icon_url}")`; elm.classList.add('has-img'); }
  else {
    elm.classList.remove('has-img'); elm.textContent = initials(s.name);
    elm.style.background = `linear-gradient(135deg, ${s.color || '#7c5cff'}, ${shade(s.color || '#7c5cff')})`;
  }
}
function srvIcon(s, cls = 'srv-icon') { const d = el('div', cls); paintServerIcon(d, s); return d; }
function shade(hex) {
  const n = parseInt(hex.slice(1), 16); const r = Math.max(0, (n >> 16) - 50), g = Math.max(0, ((n >> 8) & 255) - 50), b = Math.max(0, (n & 255) - 50);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function profileCard(p, { status = null, actions = null, extra = null } = {}) {
  const card = el('div'); card.className = 'pc-inner';
  const banner = el('div', 'pc-banner');
  if (p.banner_url) banner.style.backgroundImage = `url("${p.banner_url}")`; else banner.style.background = p.color || '#5865f2';
  const top = el('div', 'pc-top'); top.appendChild(avatar(p.id, 92, { status: status !== false, fallback: p.name }));
  const body = el('div', 'pc-body');
  body.append(el('div', 'pc-name', p.name || 'Usuário'), el('div', 'pc-tag', '@' + (p.username || 'usuario')));
  if (p.bio) { body.append(el('div', 'pc-sep'), el('label', null, 'Sobre mim'), el('div', 'pc-bio', p.bio)); }
  if (p.created_at) body.append(el('div', 'pc-sep'), el('label', null, 'Membro desde'), el('div', 'pc-bio', new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })));
  if (extra) body.appendChild(extra);
  if (actions) body.appendChild(actions);
  card.append(banner, top, body);
  return card;
}

// ---------- inicialização e login ----------
function showGate(name) { for (const g of ['loading', 'auth', 'setup', 'app']) $(g).classList.toggle('hidden', g !== name); }

async function boot() {
  hydrateIcons(); wireModals(); initPlatform();
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) { showGate('auth'); $('auth-error').textContent = 'App não configurado (src/config.js).'; return; }
  S.sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session } } = await S.sb.auth.getSession();
  if (!session) { setAuthMode('login'); showGate('auth'); return; }
  S.user = session.user; await afterLogin();
}

let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  const signup = m === 'signup';
  $('auth-name-wrap').classList.toggle('hidden', !signup);
  $('auth-sub').textContent = signup ? 'Crie sua conta' : 'Que bom te ver de novo!';
  $('auth-go').textContent = signup ? 'Criar conta' : 'Entrar';
  $('auth-switch-text').textContent = signup ? 'Já tem uma conta?' : 'Precisa de uma conta?';
  $('auth-switch').textContent = signup ? 'Entrar' : 'Criar conta';
  $('auth-pass').autocomplete = signup ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
  if (signup && !$('auth-name').value) $('auth-name').value = store.get('telao-name', '') || '';
  $('auth-user').focus();
}
$('auth-switch').onclick = (e) => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'signup' : 'login'); };
for (const id of ['auth-user', 'auth-pass', 'auth-name']) $(id).addEventListener('keydown', (e) => e.key === 'Enter' && $('auth-go').click());
$('auth-go').onclick = async () => {
  const err = $('auth-error'); err.textContent = '';
  const username = $('auth-user').value.trim().toLowerCase().replace(/^@/, '');
  const password = $('auth-pass').value;
  if (!USER_RE.test(username)) { err.textContent = 'Nome de usuário: 3 a 20 caracteres, só letras minúsculas, números, _ e ponto.'; return; }
  if (password.length < 6) { err.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
  const email = `${username}@${EMAIL_DOMAIN}`;
  $('auth-go').disabled = true;
  try {
    if (authMode === 'login') {
      const { data, error } = await S.sb.auth.signInWithPassword({ email, password });
      if (error) { err.textContent = /invalid/i.test(error.message) ? 'Usuário ou senha incorretos.' : 'Erro ao entrar: ' + error.message; return; }
      S.user = data.user; await afterLogin();
    } else {
      const name = $('auth-name').value.trim() || username;
      // A conta é criada por uma função no servidor (já confirmada, sem e-mail).
      const { data: res, error: fe } = await S.sb.functions.invoke('signup', { body: { username, password, name } });
      if (fe || !res?.ok) {
        let code = res?.error;
        try { code = code || (await fe?.context?.json())?.error; } catch {}
        err.textContent = code === 'username_taken' ? 'Esse nome de usuário já está em uso.' : 'Não foi possível criar a conta. Tente de novo.';
        return;
      }
      const { data, error } = await S.sb.auth.signInWithPassword({ email, password });
      if (error) { err.textContent = 'Conta criada, mas houve um erro ao entrar. Tente entrar de novo.'; return; }
      S.user = data.user; await afterLogin();
    }
  } finally { $('auth-go').disabled = false; }
};
$('setup-go').onclick = async () => {
  const username = $('setup-user').value.trim().toLowerCase();
  const name = $('setup-name').value.trim() || username;
  if (!USER_RE.test(username)) { $('setup-error').textContent = 'Nome de usuário inválido (3-20: a-z, 0-9, _ e ponto).'; return; }
  const { error } = await S.sb.from('profiles').insert({ id: S.user.id, username, name: name.slice(0, 24) });
  if (error) { $('setup-error').textContent = error.code === '23505' ? 'Esse nome de usuário já está em uso.' : 'Erro ao criar perfil.'; return; }
  afterLogin();
};

async function afterLogin() {
  const { data: p } = await S.sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle();
  if (!p) {
    $('setup-user').value = (S.user.email || '').split('@')[0] || '';
    showGate('setup'); return;
  }
  S.me = p; cacheProfile(p);
  enterApp();
}

async function enterApp() {
  showGate('app');
  renderMe(); startPeer(); applyMembersToggle();
  await Promise.all([loadFriendships(), loadInvites(), loadServers(), loadDMs(), loadHiddenDMs()]);
  subscribeDb(); startMyOnline(); syncOnlineSubs(); subscribeRing();
  clearInterval(S.healTimer); S.healTimer = setInterval(healRealtime, 10000); // reconecta canais que caírem
  await claimLegacy();
  renderRail();
  const last = store.get('telao-last-server', null);
  if (last && S.servers.some((s) => s.id === last)) selectServer(last); else goHome();
}

async function claimLegacy() {
  const joined = store.get('telao-joined', []); const old = store.get('telao-uid', null);
  if (!joined.length || store.get('telao-claimed', false)) return;
  const { error } = await S.sb.rpc('claim_legacy_servers', { ids: joined.map((s) => s.id), old_uid: old || '' });
  if (!error) { store.set('telao-claimed', true); await loadServers(); }
}

function renderMe() {
  $('me-avatar-wrap').replaceChildren(avatar(S.me.id, 34, { status: true }));
  $('me-name').textContent = S.me.name;
  $('me-tag').textContent = S.myStatus === 'online' ? '@' + S.me.username : STATUS_TEXT[S.myStatus];
}
$('me-who').onclick = () => { navigator.clipboard.writeText(S.me.username); toast('Nome de usuário copiado: ' + S.me.username); openProfile(S.me.id); };

// ---------- banco em tempo real ----------
function subscribeDb() {
  S.dbCh = S.sb.channel('db')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onMessageInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => onMessageUpdate(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, (p) => onFriendshipChange(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'server_invites' }, (p) => onInviteChange(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members' }, (p) => onMembersChange(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, (p) => onChannelsChange(p))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => onProfileUpdate(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, (p) => onRolesChange(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'member_roles' }, (p) => onRolesChange(p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_roles' }, () => { if (S.server) loadChannels(); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servers' }, (p) => onServerUpdate(p.new))
    .subscribe();
}
function onProfileUpdate(p) {
  if (!p?.id) return;
  cacheProfile(p);
  if (p.id === S.me.id) { S.me = p; renderMe(); }
  renderDMList(); if (S.mode === 'home' && !$('view-friends').classList.contains('hidden')) renderFriends();
  if (S.mode === 'server') { renderMembers(); renderChannels(); }
}

// ---------- status online (só amigos e quem divide servidor recebem) ----------
function startMyOnline() {
  const ch = S.sb.channel('online:' + S.user.id, { config: { private: true, presence: { key: S.user.id } } });
  ch.subscribe((st) => { if (st === 'SUBSCRIBED') trackMyStatus(); });
  S.myOnline = ch;
}
async function trackMyStatus() {
  if (!S.myOnline) return;
  if (S.myStatus === 'invisible') await S.myOnline.untrack(); else await S.myOnline.track({ status: S.myStatus });
}
function watchedUids() {
  const set = new Set();
  for (const f of acceptedFriends()) set.add(f);
  for (const m of S.members) set.add(m);
  set.delete(S.user.id); return set;
}
function syncOnlineSubs() {
  const want = watchedUids();
  for (const [uid, ch] of S.onlineSubs) if (!want.has(uid)) { S.sb.removeChannel(ch); S.onlineSubs.delete(uid); S.online.delete(uid); }
  for (const uid of want) {
    if (S.onlineSubs.has(uid)) continue;
    const ch = S.sb.channel('online:' + uid, { config: { private: true } });
    ch.on('presence', { event: 'sync' }, () => {
      const metas = Object.values(ch.presenceState()).flat();
      S.online.set(uid, metas.length ? (metas[0].status || 'online') : 'offline');
      refreshStatusDots();
    });
    ch.subscribe(); S.onlineSubs.set(uid, ch);
  }
}
let dotTimer = null;
function refreshStatusDots() {
  clearTimeout(dotTimer);
  dotTimer = setTimeout(() => {
    renderDMList(); if (S.mode === 'home' && !$('view-friends').classList.contains('hidden')) renderFriends();
    if (S.mode === 'server') renderMembers();
  }, 120);
}

// ---------- amigos ----------
const acceptedFriends = () => S.friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester === S.user.id ? f.addressee : f.requester));
function friendshipWith(uid) { return S.friendships.find((f) => (f.requester === uid && f.addressee === S.user.id) || (f.addressee === uid && f.requester === S.user.id)); }
async function loadFriendships() {
  const { data } = await S.sb.from('friendships').select('*');
  S.friendships = data || [];
  await ensureProfiles(S.friendships.flatMap((f) => [f.requester, f.addressee]));
  renderPendingBadges();
}
async function onFriendshipChange(p) {
  const n = p.new || {};
  if (p.eventType === 'INSERT' && n.addressee === S.user.id) { notifySound('friendRequest'); toast('Novo pedido de amizade!'); }
  if (p.eventType === 'UPDATE' && n.status === 'accepted' && n.requester === S.user.id) { await ensureProfiles([n.addressee]); notifySound('friendAccepted'); toast(nameOf(n.addressee) + ' aceitou seu pedido de amizade!'); }
  await loadFriendships(); syncOnlineSubs(); renderDMList();
  if (S.mode === 'home') renderFriends();
}
function renderPendingBadges() {
  const n = S.friendships.filter((f) => f.status === 'pending' && f.addressee === S.user.id).length + S.invites.filter((i) => i.to_id === S.user.id).length;
  for (const id of ['pending-badge', 'pending-count']) { $(id).textContent = n; $(id).classList.toggle('hidden', !n); }
  updateHomeBadge();
}
function updateHomeBadge() {
  const pending = S.friendships.filter((f) => f.status === 'pending' && f.addressee === S.user.id).length + S.invites.filter((i) => i.to_id === S.user.id).length;
  const dmUnread = [...S.unread].filter((c) => S.dms.has(c)).length;
  const n = pending + dmUnread;
  $('home-badge').textContent = n; $('home-badge').classList.toggle('hidden', !n);
}

function goHome() {
  S.mode = 'home'; S.server = null; S.members = []; S.roles = []; S.memberRoles = new Map(); syncOnlineSubs();
  $('server-head').classList.add('hidden'); $('channel-area').classList.add('hidden'); $('server-menu').classList.add('hidden');
  $('home-head').classList.remove('hidden'); $('home-area').classList.remove('hidden');
  releaseUnusedPresence(); renderRail(); renderDMList(); showFriends();
}
$('rail-home').onclick = goHome;
$('go-friends').onclick = showFriends;
$('cta-friends').onclick = () => { goHome(); setFtab('add'); };

function showFriends() {
  S.viewCh = null; S.textCh = null;
  showView('friends'); $('go-friends').classList.add('active'); renderDMList(); renderFriends();
}
document.querySelectorAll('.ftab').forEach((b) => (b.onclick = () => setFtab(b.dataset.ftab)));
function setFtab(t) {
  S.ftab = t; document.querySelectorAll('.ftab').forEach((b) => b.classList.toggle('active', b.dataset.ftab === t));
  $('add-friend-box').classList.toggle('hidden', t !== 'add');
  renderFriends(); if (t === 'add') $('add-friend-input').focus();
}

function renderFriends() {
  const box = $('friends-list'); box.innerHTML = '';
  const t = S.ftab;
  if (t === 'add') return;
  if (t === 'pending') {
    const incoming = S.friendships.filter((f) => f.status === 'pending' && f.addressee === S.user.id);
    const outgoing = S.friendships.filter((f) => f.status === 'pending' && f.requester === S.user.id);
    const invites = S.invites.filter((i) => i.to_id === S.user.id);
    if (!incoming.length && !outgoing.length && !invites.length) { box.appendChild(el('div', 'empty-state', 'Nenhum pedido pendente.')); return; }
    if (invites.length) {
      box.appendChild(el('div', 'group', `CONVITES PARA SERVIDORES — ${invites.length}`));
      for (const i of invites) {
        const s = i.server || { name: 'Servidor', color: '#7c5cff' };
        const row = el('div', 'f-row'); const info = el('div', 'f-info');
        info.append(el('div', 'f-name', s.name), el('div', 'f-sub', 'Convite de ' + nameOf(i.from_id)));
        const acts = el('div', 'f-actions');
        acts.append(roundBtn('check', 'Entrar', () => acceptInvite(i), 'ok'), roundBtn('x', 'Recusar', () => declineInvite(i), 'no'));
        row.append(srvIcon(s), info, acts); box.appendChild(row);
      }
    }
    if (incoming.length || outgoing.length) box.appendChild(el('div', 'group', `PEDIDOS DE AMIZADE — ${incoming.length + outgoing.length}`));
    for (const f of incoming) box.appendChild(friendRow(f.requester, 'Pedido de amizade recebido', [
      roundBtn('check', 'Aceitar', () => acceptFriend(f), 'ok'), roundBtn('x', 'Recusar', () => removeFriendship(f), 'no')]));
    for (const f of outgoing) box.appendChild(friendRow(f.addressee, 'Pedido de amizade enviado', [roundBtn('x', 'Cancelar', () => removeFriendship(f), 'no')]));
    return;
  }
  let list = acceptedFriends();
  if (t === 'online') list = list.filter((u) => statusOf(u) !== 'offline');
  list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  box.appendChild(el('div', 'group', `${t === 'online' ? 'ONLINE' : 'TODOS OS AMIGOS'} — ${list.length}`));
  if (!list.length) box.appendChild(el('div', 'empty-state', t === 'online' ? 'Nenhum amigo online agora.' : 'Você ainda não tem amigos. Clique em "Adicionar amigo".'));
  for (const uid of list) {
    box.appendChild(friendRow(uid, STATUS_TEXT[statusOf(uid)], [
      roundBtn('message', 'Mensagem', () => openDMWith(uid)),
      roundBtn('phone', 'Ligar', () => startCall(uid)),
      roundBtn('userX', 'Desfazer amizade', async () => {
        if (await confirmBox('Desfazer amizade', `Remover ${nameOf(uid)} dos seus amigos?`, 'Remover')) removeFriendship(friendshipWith(uid));
      }, 'no'),
    ], () => openDMWith(uid)));
  }
}
function friendRow(uid, sub, actions, onClick) {
  const p = prof(uid) || {};
  const row = el('div', 'f-row');
  const info = el('div', 'f-info');
  const nm = el('div', 'f-name', p.name || 'Usuário'); nm.appendChild(el('span', 'tag', '  @' + (p.username || '')));
  info.append(nm, el('div', 'f-sub', sub));
  const acts = el('div', 'f-actions'); actions.forEach((a) => acts.appendChild(a));
  row.append(avatar(uid, 36, { status: true }), info, acts);
  row.onclick = (e) => { if (e.target.closest('.f-actions')) return; onClick ? onClick() : openProfile(uid); };
  return row;
}
function roundBtn(ic, title, fn, cls = '') {
  const b = el('button', 'round-btn ' + cls); b.title = title; b.appendChild(icon(ic));
  b.onclick = (e) => { e.stopPropagation(); fn(); }; return b;
}

$('add-friend-form').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('add-friend-msg'); msg.className = 'small';
  const u = $('add-friend-input').value.trim().toLowerCase().replace(/^@/, '');
  if (!u) return;
  const { data: p } = await S.sb.from('profiles').select('*').eq('username', u).maybeSingle();
  if (!p) { msg.textContent = 'Não encontramos ninguém com esse nome de usuário.'; msg.classList.add('error'); Sound.play('error'); return; }
  sendFriendRequest(p, msg);
};
async function sendFriendRequest(p, msgEl) {
  const say = (t, ok) => { if (msgEl) { msgEl.textContent = t; msgEl.className = 'small ' + (ok ? 'ok-text' : 'error'); } else toast(t); };
  cacheProfile(p);
  if (p.id === S.user.id) return say('Esse é você!', false);
  const ex = friendshipWith(p.id);
  if (ex?.status === 'accepted') return say(`Você e ${p.name} já são amigos.`, false);
  if (ex && ex.addressee === S.user.id) return acceptFriend(ex).then(() => say(`Agora você e ${p.name} são amigos!`, true));
  if (ex) return say('Pedido já enviado.', false);
  const { error } = await S.sb.from('friendships').insert({ addressee: p.id });
  if (error) return say('Não foi possível enviar o pedido.', false);
  say(`Pedido de amizade enviado para ${p.name}!`, true); $('add-friend-input').value = '';
  await loadFriendships(); renderFriends();
}
async function acceptFriend(f) {
  const { error } = await S.sb.from('friendships').update({ status: 'accepted' }).eq('id', f.id);
  if (error) return toast('Erro ao aceitar.');
  Sound.play('friendAccepted'); await loadFriendships(); syncOnlineSubs(); renderFriends(); renderDMList();
}
async function removeFriendship(f) {
  if (!f) return;
  await S.sb.from('friendships').delete().eq('id', f.id);
  await loadFriendships(); syncOnlineSubs(); renderFriends(); renderDMList();
}

// ---------- convites para servidor ----------
async function loadInvites() {
  const { data } = await S.sb.from('server_invites').select('*, server:servers(id,name,color,icon_url)');
  S.invites = data || [];
  await ensureProfiles(S.invites.flatMap((i) => [i.from_id, i.to_id]));
  // servidor de convite recebido não é visível antes de entrar; buscamos o nome pelo convite
  for (const i of S.invites) if (!i.server && i.to_id === S.user.id) i.server = await inviteServerInfo(i);
  renderPendingBadges();
}
async function inviteServerInfo(i) {
  const { data } = await S.sb.rpc('invite_server_info', { inv: i.id });
  return data?.[0] || data || { name: 'Servidor', color: '#7c5cff' };
}
async function onInviteChange(p) {
  if (p.eventType === 'INSERT' && p.new?.to_id === S.user.id) { notifySound('invite'); toast('Você recebeu um convite para um servidor!'); }
  await loadInvites(); if (S.mode === 'home') renderFriends();
}
async function acceptInvite(i) {
  const { data: sid, error } = await S.sb.rpc('accept_invite', { inv: i.id });
  if (error) return toast('Esse convite não é mais válido.');
  Sound.play('join');
  await Promise.all([loadInvites(), loadServers()]);
  selectServer(sid);
}
async function declineInvite(i) { await S.sb.from('server_invites').delete().eq('id', i.id); await loadInvites(); renderFriends(); }

// ---------- DMs ----------
async function loadDMs() {
  const { data } = await S.sb.from('channels').select('*').eq('kind', 'dm');
  S.dms.clear();
  for (const c of data || []) S.dms.set(c.id, { ch: c, other: c.dm_a === S.user.id ? c.dm_b : c.dm_a });
  await ensureProfiles([...S.dms.values()].map((d) => d.other));
}
function dmFor(uid) { for (const d of S.dms.values()) if (d.other === uid) return d.ch; return null; }
function renderDMList() {
  const ul = $('dm-list'); ul.innerHTML = '';
  const friends = new Set(acceptedFriends());
  const list = [...S.dms.values()].filter((d) => (friends.has(d.other) || S.unread.has(d.ch.id))
    && (!S.hiddenDMs.has(d.ch.id) || S.unread.has(d.ch.id) || S.textCh?.id === d.ch.id));
  list.sort((a, b) => nameOf(a.other).localeCompare(nameOf(b.other)));
  for (const d of list) {
    const li = el('li'); const row = el('div', 'ch dm-row' + (S.textCh?.id === d.ch.id ? ' active' : '') + (S.unread.has(d.ch.id) ? ' unread' : ''));
    row.append(avatar(d.other, 32, { status: true }), el('span', 'nm', nameOf(d.other)));
    const x = el('button', 'dm-close'); x.title = 'Fechar conversa'; x.appendChild(icon('x'));
    x.onclick = (e) => { e.stopPropagation(); hideDM(d.ch); };
    row.appendChild(x);
    row.onclick = () => openText(d.ch);
    li.appendChild(row); ul.appendChild(li);
  }
  if (!list.length) ul.appendChild(el('div', 'small muted', '  Suas conversas aparecem aqui.'));
  $('go-friends').classList.toggle('active', S.mode === 'home' && !S.textCh);
  updateHomeBadge();
}
async function getDM(uid) {
  let ch = dmFor(uid);
  if (ch) return ch;
  const { data, error } = await S.sb.rpc('get_dm', { other: uid });
  if (error || !data) { toast('Vocês precisam ser amigos para conversar.'); return null; }
  S.dms.set(data.id, { ch: data, other: uid });
  return data;
}
async function openDMWith(uid) {
  const ch = await getDM(uid); if (!ch) return;
  if (S.mode !== 'home') goHome();
  closeModal('modal-profile');
  openText(ch);
}

// ---------- servidores ----------
async function loadServers() {
  const { data } = await S.sb.from('server_members').select('joined_at, server:servers(*)').eq('user_id', S.user.id).order('joined_at');
  S.servers = (data || []).map((r) => r.server).filter(Boolean);
  renderRail();
}
async function onMembersChange(p) {
  const n = p.new || {};
  if (n.user_id === S.user.id || p.eventType === 'DELETE') await loadServers();
  if (S.server && (n.server_id === S.server.id || p.eventType === 'DELETE')) await loadMembers();
  afterServersChanged();
}
function afterServersChanged() {
  if (S.server && !S.servers.some((s) => s.id === S.server.id)) {
    if (S.voice?.serverId === S.server.id) leaveVoice();
    closeModal('modal-server-settings'); closeModal('modal-channel-edit');
    toast('Você não está mais nesse servidor.'); goHome();
  }
  renderRail();
}
function serverHasUnread(sid) { for (const c of S.unread) if (S.chanServer.get(c) === sid) return true; return false; }
function renderRail() {
  $('rail-home').classList.toggle('active', S.mode === 'home');
  const box = $('rail-servers'); box.innerHTML = '';
  for (const s of S.servers) {
    const b = el('button', 'rail-btn' + (S.server?.id === s.id ? ' active' : '') + (serverHasUnread(s.id) ? ' unread' : ''));
    b.title = s.name; paintServerIcon(b, s);
    b.onclick = () => selectServer(s.id);
    b.oncontextmenu = (e) => { e.preventDefault(); leaveOrDeleteServer(s); };
    box.appendChild(b);
  }
}

async function selectServer(id) {
  const srv = S.servers.find((s) => s.id === id);
  if (!srv) return goHome();
  S.mode = 'server'; S.server = srv; store.set('telao-last-server', id);
  $('server-head').classList.remove('hidden'); $('channel-area').classList.remove('hidden');
  $('home-head').classList.add('hidden'); $('home-area').classList.add('hidden');
  $('server-name').textContent = srv.name;
  S.roles = []; S.memberRoles = new Map(); renderServerMenu();
  renderRail(); releaseUnusedPresence(); ensurePresence(id);
  await Promise.all([loadChannels(), loadMembers(), loadRoles()]);
  if (S.server?.id !== id) return;
  const lastCh = store.get('telao-last-ch-' + id, null);
  const ch = S.channels.find((c) => c.id === lastCh && c.kind === 'text') || S.channels.find((c) => c.kind === 'text');
  if (ch) openText(ch); else { S.textCh = null; showView('none'); }
}
async function loadChannels() {
  if (!S.server) return;
  const sid = S.server.id;
  const { data } = await S.sb.from('channels').select('*').eq('server_id', sid).order('created_at');
  if (S.server?.id !== sid) return;
  S.channels = data || [];
  for (const c of S.channels) S.chanServer.set(c.id, sid);
  renderChannels();
  ensureCurrentChannelValid();
}
async function loadMembers() {
  if (!S.server) return;
  const sid = S.server.id;
  const { data } = await S.sb.from('server_members').select('user_id').eq('server_id', sid);
  if (S.server?.id !== sid) return;
  S.members = (data || []).map((r) => r.user_id);
  await ensureProfiles(S.members); syncOnlineSubs(); renderMembers();
}
async function onChannelsChange(p) {
  const n = p.new || {};
  if (n.kind === 'dm') { await loadDMs(); renderDMList(); return; }
  if (S.server && (n.server_id === S.server.id || p.eventType === 'DELETE')) {
    await loadChannels();
    if (S.textCh && S.textCh.server_id && !S.channels.some((c) => c.id === S.textCh.id)) {
      const first = S.channels.find((c) => c.kind === 'text'); first ? openText(first) : showView('none');
    }
    if (S.voice && S.voice.serverId === S.server.id && !S.channels.some((c) => c.id === S.voice.channelId)) leaveVoice();
  }
}

function renderChannels() {
  const tbox = $('text-channels'), vbox = $('voice-channels');
  tbox.innerHTML = ''; vbox.innerHTML = '';
  if (!S.server) return;
  const manage = can(PERM.MANAGE_CHANNELS);
  for (const c of S.channels) {
    const li = el('li');
    const row = el('div', 'ch' + (S.viewCh?.id === c.id ? ' active' : '') + (S.unread.has(c.id) ? ' unread' : ''));
    row.append(icon(c.kind === 'text' ? 'hash' : 'volume'), el('span', 'nm', c.name));
    if (c.is_private) { const lk = icon('lock', 'ch-lock'); lk.setAttribute('aria-label', 'Canal privado'); row.appendChild(lk); }
    if (manage) {
      const gear = el('button', 'ch-del'); gear.title = 'Editar canal'; gear.appendChild(icon('settings'));
      gear.onclick = (e) => { e.stopPropagation(); openChannelEdit(c); };
      row.appendChild(gear);
    }
    row.onclick = () => (c.kind === 'text' ? openText(c) : openVoiceView(c));
    if (c.kind === 'voice') row.ondblclick = () => joinVoice(c);
    li.appendChild(row);
    if (c.kind === 'voice') {
      const users = voiceUsers(S.server.id, c.id);
      if (users.length) {
        ensureProfiles(users.map((u) => u.uid)).then(() => {});
        const ul = el('ul', 'vusers');
        for (const u of users) {
          const r = el('li'); r.append(avatar(u.uid, 24, { peer: u.peerId }), el('span', 'nm', nameOf(u.uid)));
          if (u.live) r.append(el('span', 'badge-live', 'AO VIVO'));
          if (u.deaf) r.append(icon('headphonesOff')); else if (!u.mic) r.append(icon('micOff'));
          r.onclick = (e) => { e.stopPropagation(); openProfile(u.uid); };
          ul.appendChild(r);
        }
        li.appendChild(ul);
      }
      vbox.appendChild(li);
    } else tbox.appendChild(li);
  }
}

function renderMembers() {
  const box = $('members-panel'); box.innerHTML = '';
  if (S.mode !== 'server' || !S.server) return;
  const on = [], off = [];
  for (const uid of S.members) (statusOf(uid) === 'offline' ? off : on).push(uid);
  const sort = (a, b) => nameOf(a).localeCompare(nameOf(b));
  for (const [label, list] of [['ONLINE', on.sort(sort)], ['OFFLINE', off.sort(sort)]]) {
    if (!list.length) continue;
    box.appendChild(el('div', 'group', `${label} — ${list.length}`));
    for (const uid of list) {
      const row = el('div', 'm-row' + (label === 'OFFLINE' ? ' offline' : ''));
      const nm = el('span', 'nm', nameOf(uid)); const rc = roleColor(uid); if (rc) nm.style.color = rc;
      row.append(avatar(uid, 32, { status: label === 'ONLINE' }), nm);
      if (uid === S.server.owner_id) { const c = icon('crown'); c.setAttribute('aria-label', 'Dono'); row.appendChild(c); }
      row.onclick = () => openProfile(uid);
      box.appendChild(row);
    }
  }
}
function applyMembersToggle() {
  const mobile = isMobile(); // no celular a lista desliza pela direita (body.members-open)
  $('members-panel').classList.toggle('hidden', S.mode !== 'server' || (!mobile && !S.showMembers));
  $('toggle-members').classList.toggle('on', mobile ? document.body.classList.contains('members-open') : S.showMembers);
}
$('toggle-members').onclick = () => {
  if (isMobile()) { document.body.classList.remove('nav-open'); document.body.classList.toggle('members-open'); applyMembersToggle(); return; }
  S.showMembers = !S.showMembers; store.set('telao-members', S.showMembers); applyMembersToggle();
};

// menu do servidor
$('server-head').onclick = () => $('server-menu').classList.toggle('hidden');
$('server-menu').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  $('server-menu').classList.add('hidden');
  const act = b.dataset.act;
  if (act === 'invite') openInvite();
  else if (act === 'text' || act === 'voice') openCreateChannel(act);
  else if (act === 'settings') openServerSettings();
  else if (act === 'leave') leaveOrDeleteServer(S.server);
});
async function leaveOrDeleteServer(s) {
  if (!s) return;
  const owner = s.owner_id === S.user.id;
  const ok = await confirmBox(owner ? 'Excluir servidor' : 'Sair do servidor',
    owner ? `Excluir "${s.name}" para todos? Isso apaga canais e mensagens e não pode ser desfeito.` : `Sair de "${s.name}"? Você só volta com um novo convite.`,
    owner ? 'Excluir servidor' : 'Sair');
  if (!ok) return;
  if (S.voice?.serverId === s.id) await leaveVoice();
  const { data: gone, error } = owner ? await S.sb.from('servers').delete().eq('id', s.id).select('id')
    : await S.sb.from('server_members').delete().eq('server_id', s.id).eq('user_id', S.user.id).select('server_id');
  if (error || !gone?.length) { Sound.play('error'); return toast('Não foi possível concluir.'); }
  closeModal('modal-server-settings');
  Sound.play('leave');
  await loadServers();
  if (S.server?.id === s.id) goHome();
}

async function openInvite() {
  if (!S.server) return;
  if (!can(PERM.INVITE)) { toast('Você não tem permissão para convidar pessoas.'); return; }
  $('invite-title').textContent = 'Convidar amigos para ' + S.server.name;
  const box = $('invite-list'); box.innerHTML = '';
  const members = new Set(S.members);
  const friends = acceptedFriends().filter((u) => !members.has(u)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  if (!friends.length) box.appendChild(el('div', 'empty-state', acceptedFriends().length ? 'Todos os seus amigos já estão aqui.' : 'Adicione amigos primeiro para poder convidá-los.'));
  for (const uid of friends) {
    const already = S.invites.some((i) => i.server_id === S.server.id && i.to_id === uid);
    const btn = el('button', already ? 'big' : 'primary', already ? 'Convidado' : 'Convidar'); btn.disabled = already;
    btn.onclick = async () => {
      btn.disabled = true;
      const { error } = await S.sb.from('server_invites').insert({ server_id: S.server.id, to_id: uid });
      if (error && error.code !== '23505') { btn.disabled = false; toast('Não foi possível convidar.'); return; }
      btn.textContent = 'Convidado'; btn.className = 'big'; loadInvites();
    };
    box.appendChild(friendRow(uid, '@' + (prof(uid)?.username || ''), [btn], () => {}));
  }
  openModal('modal-invite');
}

// criar servidor
let pickedColor = SERVER_COLORS[0];
function updateSrvPreview() { $('srv-preview').replaceWith(Object.assign(srvIcon({ name: $('server-name-input').value || '?', color: pickedColor }, 'srv-icon big'), { id: 'srv-preview' })); }
function openCreateServer() {
  pickedColor = SERVER_COLORS[Math.floor(Math.random() * SERVER_COLORS.length)];
  const box = $('color-pick'); box.innerHTML = '';
  for (const c of SERVER_COLORS) {
    const b = el('button', c === pickedColor ? 'sel' : ''); b.style.background = c;
    b.onclick = () => { pickedColor = c; box.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); updateSrvPreview(); };
    box.appendChild(b);
  }
  $('server-name-input').value = `Servidor de ${S.me.name}`; $('server-error').textContent = '';
  updateSrvPreview(); openModal('modal-server'); $('server-name-input').select();
}
$('server-name-input').oninput = updateSrvPreview;
$('btn-new-server').onclick = openCreateServer;
$('cta-create').onclick = openCreateServer;
$('server-name-input').addEventListener('keydown', (e) => e.key === 'Enter' && $('btn-create-server').click());
$('btn-create-server').onclick = async () => {
  const name = $('server-name-input').value.trim();
  if (!name) { $('server-error').textContent = 'Dê um nome ao servidor.'; return; }
  $('btn-create-server').disabled = true;
  const { data, error } = await S.sb.rpc('create_server', { p_name: name.slice(0, 40), p_color: pickedColor });
  $('btn-create-server').disabled = false;
  if (error) { $('server-error').textContent = 'Erro ao criar servidor.'; console.error(error); return; }
  closeModal('modal-server'); Sound.play('friendAccepted');
  await loadServers(); selectServer(data.id);
};

let newChannelKind = 'text';
function openCreateChannel(kind) {
  if (!S.server) return;
  if (!can(PERM.MANAGE_CHANNELS)) { toast('Você não tem permissão para criar canais.'); return; }
  newChannelKind = kind;
  $('channel-modal-title').textContent = kind === 'text' ? 'Criar canal de texto' : 'Criar canal de voz';
  $('channel-name-input').value = ''; $('channel-name-input').placeholder = kind === 'text' ? 'novo-canal' : 'Sala de jogos';
  openModal('modal-channel'); $('channel-name-input').focus();
}
$('add-text').onclick = () => openCreateChannel('text');
$('add-voice').onclick = () => openCreateChannel('voice');
$('channel-name-input').addEventListener('keydown', (e) => e.key === 'Enter' && $('btn-create-channel').click());
$('btn-create-channel').onclick = async () => {
  let name = $('channel-name-input').value.trim(); if (!name) return;
  if (newChannelKind === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
  const { data, error } = await S.sb.from('channels').insert({ server_id: S.server.id, name: name.slice(0, 30), kind: newChannelKind }).select().single();
  if (error) { toast('Erro ao criar canal.'); return; }
  closeModal('modal-channel');
  await loadChannels();
  data.kind === 'text' ? openText(data) : openVoiceView(data);
};

function showView(which) { for (const v of ['none', 'friends', 'text', 'voice']) $('view-' + v).classList.toggle('hidden', v !== which); updateCallbar(); }

// ---------- cargos e permissões ----------
function permsOf(uid) {
  const s = S.server; if (!s) return 0;
  if (s.owner_id === uid) return PERM_ALL;
  let p = 0; const mine = S.memberRoles.get(uid);
  for (const r of S.roles) if (r.is_default || mine?.has(r.id)) p |= Number(r.perms);
  return (p & PERM.ADMIN) ? PERM_ALL : p;
}
function can(perm) { return !!S.server && (permsOf(S.user.id) & perm) !== 0; }
function topPos(uid) {
  if (S.server?.owner_id === uid) return 1e6;
  let m = 0; const mine = S.memberRoles.get(uid);
  for (const r of S.roles) if (!r.is_default && mine?.has(r.id)) m = Math.max(m, r.position);
  return m;
}
function rolesOf(uid) { const mine = S.memberRoles.get(uid); return S.roles.filter((r) => !r.is_default && mine?.has(r.id)).sort((a, b) => b.position - a.position); }
function roleColor(uid) { const r = rolesOf(uid).find((x) => x.color && x.color.toLowerCase() !== '#99aab5'); return r ? r.color : null; }
function roleChips(rs) {
  const box = el('div', 'role-chips');
  for (const r of rs) { const c = el('span', 'role-chip'); const d = el('span', 'role-dot'); d.style.background = r.color; c.append(d, document.createTextNode(r.name)); box.appendChild(c); }
  return box;
}
function canKickUser(uid) { return !!S.server && uid !== S.user.id && uid !== S.server.owner_id && can(PERM.KICK) && topPos(uid) < topPos(S.user.id); }
async function loadRoles() {
  if (!S.server) return;
  const sid = S.server.id;
  const [r1, r2] = await Promise.all([
    S.sb.from('roles').select('*').eq('server_id', sid).order('position', { ascending: false }),
    S.sb.from('member_roles').select('user_id, role_id').eq('server_id', sid),
  ]);
  if (S.server?.id !== sid) return;
  S.roles = r1.data || [];
  S.memberRoles = new Map();
  for (const m of r2.data || []) { if (!S.memberRoles.has(m.user_id)) S.memberRoles.set(m.user_id, new Set()); S.memberRoles.get(m.user_id).add(m.role_id); }
  applyServerPerms();
}
async function onRolesChange(p) {
  const sid = p.new?.server_id || p.old?.server_id;
  if (!S.server || (sid && sid !== S.server.id)) return;
  await loadRoles(); await loadChannels();
}
function onServerUpdate(s) {
  if (!s?.id) return;
  const i = S.servers.findIndex((x) => x.id === s.id); if (i < 0) return;
  S.servers[i] = { ...S.servers[i], ...s };
  if (S.server?.id === s.id) { S.server = S.servers[i]; $('server-name').textContent = S.server.name; renderServerMenu(); }
  renderRail();
}
function broadcastRefresh() { // avisa quem está no servidor para recarregar cargos e canais
  if (S.server) S.presence.get(S.server.id)?.send({ type: 'broadcast', event: 'refresh', payload: {} });
}
function renderServerMenu() {
  if (!S.server) return;
  const owner = S.server.owner_id === S.user.id;
  $('menu-invite').classList.toggle('hidden', !can(PERM.INVITE));
  $('menu-settings').classList.toggle('hidden', !(owner || can(PERM.MANAGE_SERVER | PERM.MANAGE_ROLES | PERM.KICK)));
  for (const id of ['menu-text', 'menu-voice', 'add-text', 'add-voice']) $(id).classList.toggle('hidden', !can(PERM.MANAGE_CHANNELS));
  $('menu-leave').querySelector('span').textContent = owner ? 'Excluir servidor' : 'Sair do servidor';
}
function applyChatPerms() {
  const ch = S.textCh; if (!ch) return;
  const ok = !ch.server_id || can(PERM.SEND);
  $('chat-input').disabled = !ok;
  $('chat-input').placeholder = !ok ? 'Você não tem permissão para enviar mensagens neste canal.'
    : ch.kind === 'dm' ? 'Conversar com @' + (prof(S.dms.get(ch.id)?.other)?.username || '') : 'Conversar em #' + ch.name;
}
function applyServerPerms() {
  if (S.mode !== 'server' || !S.server) return;
  renderServerMenu(); renderChannels(); renderMembers(); applyChatPerms();
  if (S.voice && !S.voice.isDM && S.voice.serverId === S.server.id) {
    S.voice.perms = permsOf(S.user.id);
    if (!(S.voice.perms & PERM.CONNECT)) { toast('Você perdeu a permissão de ficar neste canal de voz.'); leaveVoice(); }
    else {
      const forced = !(S.voice.perms & PERM.SPEAK);
      if (forced !== S.voice.forced) { S.voice.forced = forced; if (forced) S.voice.muted = true; setMicTracks(); updateVoiceUI(); trackVoice(); }
      if (!(S.voice.perms & PERM.STREAM) && S.pubs.screen) stopShare();
    }
  }
  if (!$('modal-server-settings').classList.contains('hidden')) renderServerSettings(true);
}
function ensureCurrentChannelValid() {
  if (!S.server) return;
  const has = (ch) => S.channels.some((c) => c.id === ch.id);
  if (S.textCh && S.textCh.server_id === S.server.id && !has(S.textCh)) {
    const first = S.channels.find((c) => c.kind === 'text');
    if (first) openText(first); else { S.textCh = null; S.viewCh = null; showView('none'); }
  } else if (!S.textCh && S.viewCh && S.viewCh.server_id === S.server.id && !has(S.viewCh)) { S.viewCh = null; showView('none'); }
  if (S.voice && !S.voice.isDM && S.voice.serverId === S.server.id && !S.channels.some((c) => c.id === S.voice.channelId)) leaveVoice();
}
async function kickMember(uid) {
  if (!(await confirmBox('Expulsar membro', `Expulsar ${nameOf(uid)} de ${S.server.name}? A pessoa só volta com um novo convite.`, 'Expulsar'))) return false;
  const { data, error } = await S.sb.from('server_members').delete().eq('server_id', S.server.id).eq('user_id', uid).select('user_id');
  if (error || !data?.length) { toast('Não foi possível expulsar.'); Sound.play('error'); return false; }
  await Promise.all([loadMembers(), loadRoles()]);
  if (!$('modal-server-settings').classList.contains('hidden')) renderSSMembers();
  return true;
}
async function setMemberRole(uid, roleId, on) {
  const { error } = await S.sb.rpc('set_member_role', { p_server: S.server.id, p_user: uid, p_role: roleId, p_on: on });
  if (error) { toast(error.message); Sound.play('error'); return; }
  await loadRoles(); broadcastRefresh();
}

// ---------- editar canal (nome e privacidade) ----------
let editingCh = null;
async function openChannelEdit(c) {
  if (!can(PERM.MANAGE_CHANNELS)) return;
  editingCh = c;
  $('ce-title').textContent = c.kind === 'text' ? 'Editar canal de texto' : 'Editar canal de voz';
  $('ce-name').value = c.name; $('ce-private').checked = !!c.is_private;
  const { data } = await S.sb.from('channel_roles').select('role_id').eq('channel_id', c.id);
  const allowed = new Set((data || []).map((r) => r.role_id));
  const box = $('ce-roles'); box.innerHTML = '';
  const roles = S.roles.filter((r) => !r.is_default).sort((a, b) => b.position - a.position);
  if (!roles.length) box.appendChild(el('div', 'small muted', 'Crie cargos em Configurações do servidor → Cargos para escolher quem vê este canal.'));
  for (const r of roles) {
    const lab = el('label', 'check'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = r.id; cb.checked = allowed.has(r.id);
    const dot = el('span', 'role-dot'); dot.style.background = r.color;
    lab.append(cb, dot, document.createTextNode(r.name)); box.appendChild(lab);
  }
  const sync = () => box.classList.toggle('disabled', !$('ce-private').checked);
  $('ce-private').onchange = sync; sync();
  openModal('modal-channel-edit'); $('ce-name').focus();
}
$('ce-save').onclick = async () => {
  const c = editingCh; if (!c) return;
  let name = $('ce-name').value.trim(); if (!name) return;
  if (c.kind === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
  const roles = [...$('ce-roles').querySelectorAll('input:checked')].map((i) => i.value);
  $('ce-save').disabled = true;
  const r1 = await S.sb.from('channels').update({ name: name.slice(0, 30) }).eq('id', c.id).select('id');
  const r2 = await S.sb.rpc('set_channel_access', { p_channel: c.id, p_private: $('ce-private').checked, p_roles: roles });
  $('ce-save').disabled = false;
  if (r1.error || !r1.data?.length || r2.error) { toast('Não foi possível salvar o canal.'); Sound.play('error'); return; }
  closeModal('modal-channel-edit'); broadcastRefresh(); await loadChannels();
};
$('ce-delete').onclick = async () => {
  const c = editingCh; if (!c) return;
  if (!(await confirmBox('Apagar canal', `Apagar "${c.name}" e todas as mensagens dele? Não dá para desfazer.`, 'Apagar canal'))) return;
  const { data, error } = await S.sb.from('channels').delete().eq('id', c.id).select('id');
  if (error || !data?.length) { toast('Não foi possível apagar o canal.'); Sound.play('error'); return; }
  closeModal('modal-channel-edit'); broadcastRefresh(); await loadChannels();
};

// ---------- configurações do servidor ----------
let ssSection = 'overview', ssDraft = null, editingRoleId = null;
function openServerSettings(section) {
  if (!S.server) return;
  ssDraft = { color: S.server.color || SERVER_COLORS[0], icon_url: S.server.icon_url || null };
  editingRoleId = null; ssSection = section || 'overview'; $('ss-member-search').value = '';
  renderServerSettings(false); openModal('modal-server-settings');
}
document.querySelectorAll('.sn[data-ssn]').forEach((b) => (b.onclick = () => { ssSection = b.dataset.ssn; renderServerSettings(false); }));
function renderServerSettings(fromRealtime) {
  if (!S.server) { closeModal('modal-server-settings'); return; }
  const owner = S.server.owner_id === S.user.id;
  $('ss-label').textContent = S.server.name.toUpperCase();
  $('ss-delete').classList.toggle('hidden', !owner);
  const show = { overview: can(PERM.MANAGE_SERVER), roles: can(PERM.MANAGE_ROLES), members: owner || can(PERM.MANAGE_SERVER | PERM.MANAGE_ROLES | PERM.KICK) };
  document.querySelectorAll('.sn[data-ssn]').forEach((b) => b.classList.toggle('hidden', !show[b.dataset.ssn]));
  if (!show[ssSection]) {
    const first = Object.keys(show).find((k) => show[k]);
    if (!first) { closeModal('modal-server-settings'); return; }
    ssSection = first; fromRealtime = false;
  }
  document.querySelectorAll('.sn[data-ssn]').forEach((b) => b.classList.toggle('active', b.dataset.ssn === ssSection));
  document.querySelectorAll('section[data-ssp]').forEach((x) => x.classList.toggle('hidden', x.dataset.ssp !== ssSection));
  if (ssSection === 'overview') { if (fromRealtime) renderSSIcon(); else initSSOverview(); }
  else if (ssSection === 'roles') renderSSRoles(fromRealtime);
  else renderSSMembers();
}
function initSSOverview() {
  $('ss-name').value = S.server.name; $('ss-msg').textContent = '';
  const box = $('ss-colors'); box.innerHTML = '';
  for (const c of SERVER_COLORS) {
    const b = el('button', c === ssDraft.color ? 'sel' : ''); b.style.background = c; b.title = c;
    b.onclick = () => { ssDraft.color = c; box.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); renderSSIcon(); };
    box.appendChild(b);
  }
  renderSSIcon();
}
function renderSSIcon() {
  const d = srvIcon({ name: $('ss-name').value || S.server.name, color: ssDraft.color, icon_url: ssDraft.icon_url }, 'srv-icon huge');
  d.id = 'ss-icon'; $('ss-icon').replaceWith(d);
  $('ss-icon-rm').disabled = !ssDraft.icon_url;
}
$('ss-name').oninput = () => renderSSIcon();
$('ss-icon-btn').onclick = () => $('file-server-icon').click();
$('ss-icon-rm').onclick = () => { ssDraft.icon_url = null; renderSSIcon(); };
$('file-server-icon').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  $('ss-msg').className = 'small'; $('ss-msg').textContent = 'Enviando...';
  try { ssDraft.icon_url = await uploadImage(file, 'server'); renderSSIcon(); $('ss-msg').textContent = 'Ícone carregado. Clique em "Salvar alterações".'; }
  catch (err) { $('ss-msg').className = 'small error'; $('ss-msg').textContent = err.message || 'Erro ao enviar a imagem.'; }
};
$('ss-save').onclick = async () => {
  const name = $('ss-name').value.trim();
  if (!name) { $('ss-msg').className = 'small error'; $('ss-msg').textContent = 'O servidor precisa de um nome.'; return; }
  $('ss-save').disabled = true;
  const { data, error } = await S.sb.from('servers').update({ name: name.slice(0, 40), color: ssDraft.color, icon_url: ssDraft.icon_url }).eq('id', S.server.id).select().maybeSingle();
  $('ss-save').disabled = false;
  if (error || !data) { $('ss-msg').className = 'small error'; $('ss-msg').textContent = 'Não foi possível salvar.'; Sound.play('error'); return; }
  onServerUpdate(data); $('ss-label').textContent = data.name.toUpperCase();
  $('ss-msg').className = 'small ok-text'; $('ss-msg').textContent = 'Servidor atualizado!';
};
$('ss-delete').onclick = () => leaveOrDeleteServer(S.server);

function sortedRoles() { return [...S.roles].sort((a, b) => (a.is_default - b.is_default) || (b.position - a.position)); }
function renderSSRoles(keepEditor) {
  const list = $('roles-list'); list.innerHTML = '';
  const mytop = topPos(S.user.id);
  for (const r of sortedRoles()) {
    const editable = r.is_default || r.position < mytop;
    const row = el('div', 'role-row' + (editingRoleId === r.id ? ' active' : ''));
    const dot = el('span', 'role-dot'); dot.style.background = r.color;
    const count = r.is_default ? S.members.length : [...S.memberRoles.values()].filter((set) => set.has(r.id)).length;
    row.append(dot, el('span', 'nm', r.name), el('span', 'role-count', String(count)));
    if (!r.is_default && editable) {
      const up = el('button', 'mini'); up.title = 'Subir (mais poder)'; up.appendChild(icon('chevron', 'rot180'));
      up.onclick = (e) => { e.stopPropagation(); moveRole(r, 1); };
      const dn = el('button', 'mini'); dn.title = 'Descer (menos poder)'; dn.appendChild(icon('chevron'));
      dn.onclick = (e) => { e.stopPropagation(); moveRole(r, -1); };
      row.append(up, dn);
    }
    if (!editable) { const lk = icon('lock', 'role-lock'); row.appendChild(lk); }
    row.onclick = () => { editingRoleId = r.id; renderSSRoles(false); };
    list.appendChild(row);
  }
  if (keepEditor && editingRoleId && S.roles.some((r) => r.id === editingRoleId)) return;
  if (!S.roles.some((r) => r.id === editingRoleId)) editingRoleId = null;
  renderRoleEditor();
}
function renderRoleEditor() {
  const box = $('role-editor'); box.innerHTML = '';
  const r = S.roles.find((x) => x.id === editingRoleId);
  if (!r) { box.appendChild(el('div', 'empty-state', 'Escolha um cargo na lista para editar, ou crie um novo.')); return; }
  const mine = permsOf(S.user.id); const mytop = topPos(S.user.id);
  const editable = r.is_default || r.position < mytop;
  box.appendChild(el('h3', null, r.is_default ? 'CARGO PADRÃO — VALE PARA TODOS OS MEMBROS' : 'EDITAR CARGO'));
  const name = el('input'); name.maxLength = 30; name.value = r.name; name.disabled = r.is_default || !editable;
  let color = r.color;
  const colorRow = el('div', 'color-pick');
  const custom = document.createElement('input'); custom.type = 'color'; custom.value = color; custom.disabled = !editable;
  for (const c of ROLE_COLORS) {
    const b = el('button', c.toLowerCase() === color.toLowerCase() ? 'sel' : ''); b.style.background = c; b.disabled = !editable;
    b.onclick = () => { color = c; custom.value = c; colorRow.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); };
    colorRow.appendChild(b);
  }
  custom.oninput = () => { color = custom.value; colorRow.querySelectorAll('button').forEach((x) => x.classList.remove('sel')); };
  colorRow.appendChild(custom);
  box.append(el('label', null, 'Nome do cargo'), name, el('label', null, 'Cor'), colorRow, el('label', null, 'Permissões'));
  let perms = Number(r.perms);
  const permBox = el('div', 'perm-list');
  for (const [key, title, desc] of PERM_INFO) {
    const bit = PERM[key];
    const row = el('label', 'perm-row');
    const info = el('div', 'perm-info'); info.append(el('div', 'perm-title', title), el('div', 'perm-desc', desc));
    const sw = document.createElement('input'); sw.type = 'checkbox'; sw.className = 'switch'; sw.checked = (perms & bit) !== 0;
    sw.disabled = !editable || (mine !== PERM_ALL && (mine & bit) === 0); // ninguém dá permissão que não tem
    sw.onchange = () => { perms = sw.checked ? (perms | bit) : (perms & ~bit); };
    row.append(info, sw); permBox.appendChild(row);
  }
  box.appendChild(permBox);
  if (!editable) box.appendChild(el('p', 'small muted', 'Você só pode editar cargos abaixo do seu cargo mais alto.'));
  const foot = el('div', 'row-gap');
  const save = el('button', 'primary', 'Salvar cargo'); save.disabled = !editable;
  const msg = el('span', 'small');
  save.onclick = async () => {
    save.disabled = true;
    const { error } = await S.sb.rpc('save_role', { p_server: S.server.id, p_role: r.id, p_name: name.value, p_color: color, p_perms: perms });
    save.disabled = false;
    if (error) { msg.className = 'small error'; msg.textContent = error.message; Sound.play('error'); return; }
    msg.className = 'small ok-text'; msg.textContent = 'Cargo salvo!';
    await loadRoles(); broadcastRefresh(); renderSSRoles(true);
  };
  foot.appendChild(save);
  if (!r.is_default) {
    const del = el('button', 'danger-btn', 'Excluir cargo'); del.disabled = !editable;
    del.onclick = async () => {
      if (!(await confirmBox('Excluir cargo', `Excluir o cargo "${r.name}"? Quem tem esse cargo perde as permissões dele.`, 'Excluir'))) return;
      const { error } = await S.sb.rpc('delete_role', { p_role: r.id });
      if (error) { toast(error.message); Sound.play('error'); return; }
      editingRoleId = null; await loadRoles(); broadcastRefresh(); renderSSRoles(false);
    };
    foot.appendChild(del);
  }
  foot.appendChild(msg);
  box.appendChild(foot);
}
$('role-new').onclick = async () => {
  const { data, error } = await S.sb.rpc('save_role', {
    p_server: S.server.id, p_role: null, p_name: 'novo cargo', p_color: ROLE_COLORS[1 + Math.floor(Math.random() * (ROLE_COLORS.length - 1))], p_perms: 0,
  });
  if (error) { toast(error.message); Sound.play('error'); return; }
  editingRoleId = data.id; await loadRoles(); broadcastRefresh(); renderSSRoles(false);
};
async function moveRole(r, dir) {
  const { error } = await S.sb.rpc('move_role', { p_role: r.id, p_dir: dir });
  if (error) { toast(error.message); Sound.play('error'); return; }
  await loadRoles(); broadcastRefresh(); renderSSRoles(true);
}
function renderSSMembers() {
  const box = $('ss-members'); box.innerHTML = '';
  const q = $('ss-member-search').value.trim().toLowerCase();
  const mytop = topPos(S.user.id); const canRoles = can(PERM.MANAGE_ROLES);
  const list = S.members.filter((uid) => !q || nameOf(uid).toLowerCase().includes(q) || (prof(uid)?.username || '').includes(q))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  for (const uid of list) {
    const row = el('div', 'ssm-row');
    const info = el('div', 'f-info');
    const nm = el('div', 'f-name', nameOf(uid)); const rc = roleColor(uid); if (rc) nm.style.color = rc;
    info.append(nm, el('div', 'f-sub', '@' + (prof(uid)?.username || '') + (uid === S.server.owner_id ? ' • dono do servidor' : '')));
    const chips = el('div', 'role-chips');
    const manageable = canRoles && (uid === S.user.id || topPos(uid) < mytop);
    for (const r of rolesOf(uid)) {
      const chip = el('span', 'role-chip'); const dot = el('span', 'role-dot'); dot.style.background = r.color;
      chip.append(dot, document.createTextNode(r.name));
      if (manageable && r.position < mytop) {
        const x = el('button', 'chip-x'); x.title = 'Tirar cargo'; x.appendChild(icon('x'));
        x.onclick = () => setMemberRole(uid, r.id, false); chip.appendChild(x);
      }
      chips.appendChild(chip);
    }
    if (manageable) {
      const avail = S.roles.filter((r) => !r.is_default && r.position < mytop && !S.memberRoles.get(uid)?.has(r.id)).sort((a, b) => b.position - a.position);
      if (avail.length) {
        const sel = document.createElement('select'); sel.className = 'role-add';
        sel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: '+ Dar cargo' }));
        for (const r of avail) sel.appendChild(Object.assign(document.createElement('option'), { value: r.id, textContent: r.name }));
        sel.onchange = () => { if (sel.value) setMemberRole(uid, sel.value, true); };
        chips.appendChild(sel);
      }
    }
    row.append(avatar(uid, 36), info, chips);
    if (canKickUser(uid)) { const k = el('button', 'danger-btn small-btn', 'Expulsar'); k.onclick = () => kickMember(uid); row.appendChild(k); }
    row.querySelector('.av').onclick = () => openProfile(uid);
    box.appendChild(row);
  }
  if (!list.length) box.appendChild(el('div', 'empty-state', 'Ninguém encontrado.'));
}
$('ss-member-search').oninput = renderSSMembers;

// ---------- fechar conversas diretas ----------
async function loadHiddenDMs() {
  const { data } = await S.sb.from('dm_hidden').select('channel_id, hidden_at');
  S.hiddenDMs = new Map((data || []).map((r) => [r.channel_id, r.hidden_at]));
  // mensagem nova chegou enquanto o app estava fechado: a conversa volta para a lista
  for (const [cid, at] of [...S.hiddenDMs]) {
    const { data: m } = await S.sb.from('messages').select('id').eq('channel_id', cid).neq('author_id', S.user.id).eq('deleted', false).gt('created_at', at).limit(1);
    if (m?.length) { S.unread.add(cid); unhideDM(cid); }
  }
}
async function hideDM(ch) {
  const at = new Date().toISOString();
  S.hiddenDMs.set(ch.id, at);
  S.unread.delete(ch.id); // fechar a conversa também marca como lida (como no Discord)
  if (S.textCh?.id === ch.id) showFriends(); else renderDMList();
  const { error } = await S.sb.from('dm_hidden').upsert({ user_id: S.user.id, channel_id: ch.id, hidden_at: at });
  if (error) { S.hiddenDMs.delete(ch.id); renderDMList(); toast('Não foi possível fechar a conversa.'); }
}
function unhideDM(cid) {
  if (!S.hiddenDMs.has(cid)) return;
  S.hiddenDMs.delete(cid);
  S.sb.from('dm_hidden').delete().eq('channel_id', cid).then(() => {});
}

// ---------- versão web (navegador) ----------
let downloadUrl = RELEASES_URL;
function initPlatform() {
  document.body.classList.toggle('is-web', !IS_DESKTOP);
  if (IS_DESKTOP) return;
  document.querySelector('.sn[data-sn="advanced"]')?.classList.add('hidden');
  document.querySelector('.picker-hint')?.classList.add('hidden');
  if (!IS_MOBILE_DEVICE) { // no celular não faz sentido oferecer o instalador do Windows
    document.querySelectorAll('.download-app').forEach((b) => b.classList.remove('hidden'));
    resolveDownloadUrl();
  }
  initResponsive();
}

// ---------- celular ----------
function initResponsive() {
  const welcomeHead = el('div', 'main-head mobile-only'); welcomeHead.appendChild(el('b', null, 'Telao'));
  $('view-none').prepend(welcomeHead);
  document.querySelectorAll('.main-head').forEach((h) => { // botão ☰ em cada cabeçalho
    const b = el('button', 'nav-toggle'); b.title = 'Menu'; b.setAttribute('aria-label', 'Abrir menu'); b.appendChild(icon('menu'));
    b.onclick = openNav; h.prepend(b);
  });
  const backdrop = el('div', 'nav-backdrop'); backdrop.id = 'nav-backdrop'; backdrop.onclick = closeOverlays;
  $('app').appendChild(backdrop);
  const bar = el('div', 'mobile-callbar hidden'); bar.id = 'mobile-callbar';
  bar.append(icon('volume'), el('span', null, 'Na chamada'));
  bar.onclick = () => { if (S.voice) openVoiceView(S.voice.ch); };
  document.querySelector('.main').prepend(bar);
  // tocar num canal, numa conversa ou em "Amigos" fecha o menu
  document.querySelector('.sidebar').addEventListener('click', (e) => {
    if (!isMobile()) return;
    if (!e.target.closest('.ch') || e.target.closest('.ch-del, .dm-close, .mini')) return;
    closeOverlays();
  });
  // no toque, editar/apagar aparecem ao tocar na mensagem
  $('messages').addEventListener('click', (e) => {
    if (!window.matchMedia('(hover: none)').matches) return;
    const row = e.target.closest('.msg'); if (!row || e.target.closest('.av, .msg-author, .msg-actions, input')) return;
    document.querySelectorAll('.msg.show-actions').forEach((x) => { if (x !== row) x.classList.remove('show-actions'); });
    row.classList.toggle('show-actions');
  });
  if (!CAN_SHARE) { $('ctl-share').classList.add('hidden'); $('vp-share').classList.add('hidden'); }
  window.addEventListener('resize', () => { if (!isMobile()) document.body.classList.remove('nav-open', 'members-open'); applyMembersToggle(); });
}
function openNav() { document.body.classList.remove('members-open'); document.body.classList.add('nav-open'); applyMembersToggle(); }
function closeOverlays() { document.body.classList.remove('nav-open', 'members-open'); applyMembersToggle(); }
function updateCallbar() {
  const bar = $('mobile-callbar'); if (!bar) return;
  const watching = S.voice && S.viewCh?.id === S.voice.channelId && !$('view-voice').classList.contains('hidden');
  bar.classList.toggle('hidden', !S.voice || !!watching);
  if (S.voice) bar.querySelector('span').textContent = 'Na chamada: ' + (S.voice.isDM ? nameOf(S.dms.get(S.voice.channelId)?.other) : S.voice.ch.name) + ' — toque para voltar';
}
function showAudioUnlock() { // celulares bloqueiam som que não começou com um toque
  if ($('audio-unlock')) return;
  const b = el('button', 'audio-unlock', 'Toque para ativar o som da chamada'); b.id = 'audio-unlock';
  b.onclick = () => {
    document.querySelectorAll('audio.remote-audio, .tile video:not(.local)').forEach((m) => m.play?.().catch(() => {}));
    Sound.play('click'); b.remove();
  };
  document.body.appendChild(b);
}
async function resolveDownloadUrl() { // link direto para o instalador mais recente
  try {
    const r = await fetch('https://api.github.com/repos/ErikLima173/telao-releases/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const j = await r.json();
    const exe = (j.assets || []).find((a) => /\.exe$/i.test(a.name));
    if (exe) {
      downloadUrl = exe.browser_download_url;
      document.querySelectorAll('.download-ver').forEach((s) => (s.textContent = ' (versão ' + String(j.tag_name || '').replace(/^v/, '') + ')'));
    }
  } catch {}
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.download-app'); if (!b) return;
  e.preventDefault(); window.open(downloadUrl, '_blank', 'noopener');
});

// ---------- perfil (popup) ----------
async function openProfile(uid) {
  await ensureProfiles([uid]);
  const p = prof(uid); if (!p) return;
  const acts = el('div', 'pc-actions');
  if (uid === S.user.id) {
    const b = el('button', 'primary', 'Editar perfil'); b.onclick = () => { closeModal('modal-profile'); openSettings('profile'); }; acts.appendChild(b);
  } else {
    const f = friendshipWith(uid);
    if (f?.status === 'accepted') {
      const m = el('button', 'primary', 'Mensagem'); m.onclick = () => openDMWith(uid);
      const c = el('button', 'big', 'Ligar'); c.onclick = () => { closeModal('modal-profile'); startCall(uid); };
      acts.append(m, c);
    } else if (f && f.addressee === S.user.id) {
      const a = el('button', 'primary', 'Aceitar pedido'); a.onclick = async () => { await acceptFriend(f); closeModal('modal-profile'); }; acts.appendChild(a);
    } else if (f) {
      const a = el('button', 'big', 'Pedido enviado'); a.disabled = true; acts.appendChild(a);
    } else {
      const a = el('button', 'primary', 'Adicionar amigo'); a.onclick = async () => { await sendFriendRequest(p, null); closeModal('modal-profile'); }; acts.appendChild(a);
    }
    if (S.mode === 'server' && S.members.includes(uid) && canKickUser(uid)) {
      const k = el('button', 'danger-btn', 'Expulsar');
      k.onclick = async () => { if (await kickMember(uid)) closeModal('modal-profile'); };
      acts.appendChild(k);
    }
  }
  let extra = null;
  if (S.mode === 'server' && S.members.includes(uid)) {
    const rs = rolesOf(uid);
    if (rs.length) { extra = el('div'); extra.append(el('div', 'pc-sep'), el('label', null, 'Cargos'), roleChips(rs)); }
  }
  $('profile-card').replaceChildren(profileCard(p, { actions: acts, extra }));
  openModal('modal-profile');
}

// ---------- chat (canais e DMs) ----------
async function openText(ch) {
  S.viewCh = ch; S.textCh = ch; S.unread.delete(ch.id); S.lastRender = null; S.lateMsgs = [];
  if (ch.server_id) store.set('telao-last-ch-' + ch.server_id, ch.id);
  const isDM = ch.kind === 'dm';
  if (isDM) unhideDM(ch.id);
  showView('text');
  const other = isDM ? S.dms.get(ch.id)?.other : null;
  $('text-icon').replaceChildren(icon(isDM ? 'at' : 'hash'));
  $('text-title').textContent = isDM ? nameOf(other) : ch.name;
  $('dm-call').classList.toggle('hidden', !isDM);
  $('toggle-members').classList.toggle('hidden', isDM);
  applyMembersToggle();
  applyChatPerms();
  $('messages').innerHTML = ''; renderTyping();
  if (isDM) { ensurePresence(ch.id); renderDMList(); } else { renderChannels(); renderRail(); }
  updateHomeBadge();

  const { data, error } = await S.sb.from('messages').select('*').eq('channel_id', ch.id).eq('deleted', false).order('id', { ascending: false }).limit(80);
  if (error) { toast('Erro ao carregar mensagens.'); return; }
  if (S.textCh?.id !== ch.id) return;
  await ensureProfiles(data.map((m) => m.author_id));
  if (S.textCh?.id !== ch.id) return;
  $('messages').innerHTML = ''; S.lastRender = null;
  if (data.length < 80) $('messages').appendChild(channelWelcome(ch, other));
  data.reverse().forEach((m) => renderMessage(m));
  // mensagens que chegaram enquanto o histórico carregava
  for (const m of S.lateMsgs.splice(0)) if (m.channel_id === ch.id && !data.some((d) => d.id === m.id) && !$('messages').querySelector(`[data-id="${m.id}"]`)) renderMessage(m);
  scrollChat(true);
  $('chat-input').focus();
}
function channelWelcome(ch, other) {
  const w = el('div', 'channel-welcome');
  if (ch.kind === 'dm') {
    w.appendChild(avatar(other, 80));
    w.append(el('h1', null, nameOf(other)), el('p', null, 'Este é o começo do seu histórico de mensagens diretas com @' + (prof(other)?.username || '') + '.'));
  } else {
    const ic = el('div', 'cw-ico'); ic.appendChild(icon('hash'));
    w.append(ic, el('h1', null, 'Bem-vindo a #' + ch.name + '!'), el('p', null, 'Este é o começo do canal #' + ch.name + '.'));
  }
  return w;
}
function scrollChat(force) {
  const box = $('messages');
  if (force || box.scrollHeight - box.scrollTop - box.clientHeight < 200) box.scrollTop = box.scrollHeight;
}
function mentionsMe(text) { return S.me && new RegExp('@' + S.me.username.replace('.', '\\.') + '\\b', 'i').test(text || ''); }
function fillText(div, m) {
  div.innerHTML = '';
  const parts = String(m.text).split(/(@[a-z0-9_.]{3,20})/gi);
  for (const part of parts) {
    if (/^@[a-z0-9_.]{3,20}$/i.test(part)) div.appendChild(el('span', 'mention-tag', part));
    else if (part) div.appendChild(document.createTextNode(part));
  }
  if (m.edited_at) div.appendChild(el('span', 'edited', '(editado)'));
}
function renderMessage(m) {
  if (m.deleted) return;
  const box = $('messages');
  const t = new Date(m.created_at);
  const last = S.lastRender;
  const newDay = !last || last.t.toDateString() !== t.toDateString();
  if (newDay) box.appendChild(el('div', 'day-sep', fmtDay(t)));
  const cont = !newDay && last && last.author === m.author_id && t - last.t < 5 * 60 * 1000;
  const row = el('div', 'msg' + (cont ? ' cont' : '') + (mentionsMe(m.text) ? ' mention' : ''));
  row.dataset.id = m.id;
  const body = el('div', 'msg-body');
  if (!cont) {
    const av = avatar(m.author_id, 40, { fallback: m.author }); av.onclick = () => openProfile(m.author_id);
    row.appendChild(av);
    const head = el('div', 'msg-head');
    const a = el('span', 'msg-author', prof(m.author_id)?.name || m.author || 'Usuário'); a.onclick = () => openProfile(m.author_id);
    const rc = S.textCh?.server_id ? roleColor(m.author_id) : null; if (rc) a.style.color = rc;
    head.append(a, el('span', 'msg-time', (newDay ? '' : fmtDay(t) + ' às ') + fmtTime(t)));
    body.appendChild(head);
  }
  const txt = el('div', 'msg-text'); fillText(txt, m); body.appendChild(txt);
  row.appendChild(body);
  const mineMsg = m.author_id === S.user.id;
  const canMod = !mineMsg && !!S.textCh?.server_id && can(PERM.MANAGE_MESSAGES);
  if (mineMsg || canMod) {
    const acts = el('div', 'msg-actions');
    if (mineMsg) { const e = el('button'); e.title = 'Editar'; e.appendChild(icon('edit')); e.onclick = () => editMessage(row, m); acts.appendChild(e); }
    const d = el('button'); d.title = mineMsg ? 'Apagar' : 'Apagar (moderação)'; d.appendChild(icon('trash')); d.onclick = () => deleteMessage(m);
    acts.appendChild(d); row.appendChild(acts);
  }
  row._msg = m;
  box.appendChild(row);
  S.lastRender = { author: m.author_id, t };
}
function editMessage(row, m) {
  const txt = row.querySelector('.msg-text'); if (!txt || row.querySelector('.msg-edit')) return;
  const input = el('input', 'msg-edit'); input.value = m.text; input.maxLength = 1000;
  const hint = el('div', 'msg-edit-hint', 'Enter para salvar • Esc para cancelar');
  txt.replaceWith(input); input.after(hint); input.focus();
  const restore = () => { input.replaceWith(txt); hint.remove(); };
  input.onkeydown = async (e) => {
    if (e.key === 'Escape') restore();
    if (e.key === 'Enter') {
      const v = input.value.trim();
      if (!v || v === m.text) return restore();
      const { error } = await S.sb.from('messages').update({ text: v }).eq('id', m.id);
      if (error) toast('Erro ao editar.'); restore();
    }
  };
}
async function deleteMessage(m) {
  if (!(await confirmBox('Apagar mensagem', 'Tem certeza que quer apagar esta mensagem?', 'Apagar'))) return;
  const { error } = await S.sb.from('messages').update({ deleted: true }).eq('id', m.id);
  if (error) toast('Erro ao apagar.');
}
async function onMessageInsert(m) {
  if (!m?.channel_id) return;
  await ensureProfiles([m.author_id]);
  S.typing.delete(m.author_id); renderTyping();
  if (S.textCh?.id === m.channel_id) {
    S.lateMsgs.push(m);
    if (!$('messages').querySelector(`[data-id="${m.id}"]`)) { renderMessage(m); scrollChat(m.author_id === S.user.id); }
    if (m.author_id !== S.user.id) { if (!document.hasFocus()) notifySound('notify'); else Sound.play('message'); }
    return;
  }
  if (m.author_id === S.user.id) return;
  S.unread.add(m.channel_id);
  const isDM = S.dms.has(m.channel_id) || (await isDMChannel(m.channel_id));
  if (isDM) unhideDM(m.channel_id);
  if (isDM || mentionsMe(m.text)) notifySound('notify');
  if (!isDM && !S.chanServer.has(m.channel_id)) {
    const { data } = await S.sb.from('channels').select('id, server_id').eq('id', m.channel_id).maybeSingle();
    if (data?.server_id) S.chanServer.set(data.id, data.server_id);
  }
  renderRail(); renderChannels(); renderDMList(); updateHomeBadge();
}
async function isDMChannel(id) {
  if (S.chanServer.has(id)) return false;
  await loadDMs(); return S.dms.has(id);
}
function onMessageUpdate(m) {
  if (S.textCh?.id !== m.channel_id) return;
  const row = $('messages').querySelector(`[data-id="${m.id}"]`); if (!row) return;
  if (m.deleted) {
    const next = row.nextElementSibling;
    if (!row.classList.contains('cont') && next?.classList.contains('cont')) { openText(S.textCh); return; } // refaz agrupamento
    row.remove(); return;
  }
  row._msg = m; const txt = row.querySelector('.msg-text'); if (txt) fillText(txt, m);
}
function notifySound(name) { if (S.myStatus !== 'dnd') Sound.play(name); }

$('chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim(); if (!text || !S.textCh) return;
  $('chat-input').value = '';
  const { data, error } = await S.sb.from('messages').insert({ channel_id: S.textCh.id, author: S.me.name, text: text.slice(0, 1000) }).select().single();
  if (error) { toast('Não foi possível enviar.'); $('chat-input').value = text; Sound.play('error'); return; }
  if (data.channel_id === S.textCh?.id) S.lateMsgs.push(data);
  if (data.channel_id === S.textCh?.id && !$('messages').querySelector(`[data-id="${data.id}"]`)) { renderMessage(data); scrollChat(true); }
};
$('chat-input').addEventListener('input', () => {
  if (!S.textCh || Date.now() - S.lastTypingSent < 2500 || !$('chat-input').value) return;
  S.lastTypingSent = Date.now();
  const ch = S.presence.get(scopeOf(S.textCh));
  ch?.send({ type: 'broadcast', event: 'typing', payload: { uid: S.user.id, ch: S.textCh.id } });
});
function onTyping(p) {
  if (!p || p.uid === S.user.id) return;
  S.typing.set(p.uid, { ch: p.ch, until: Date.now() + 4000 });
  ensureProfiles([p.uid]).then(renderTyping);
}
function renderTyping() {
  const now = Date.now();
  const who = [...S.typing].filter(([, v]) => v.until > now && v.ch === S.textCh?.id).map(([uid]) => nameOf(uid));
  const box = $('typing'); box.innerHTML = '';
  if (!who.length) return;
  const b = el('b', null, who.slice(0, 3).join(', '));
  box.append(b, document.createTextNode(who.length > 1 ? ' estão digitando...' : ' está digitando...'));
}
setInterval(renderTyping, 1000);
$('dm-call').onclick = () => { const d = S.dms.get(S.textCh?.id); if (d) startCall(d.other); };

// ---------- presença por servidor/DM (quem está na voz + digitando) ----------
const scopeOf = (ch) => ch.server_id || ch.id;
const isDeadChannel = (ch) => !ch || ch.state === 'closed';
function presenceInUse(scope) { return S.server?.id === scope || S.voice?.serverId === scope || (S.textCh && scopeOf(S.textCh) === scope); }
function dropChannel(ch) { if (!ch) return; ch._intentional = true; S.sb.removeChannel(ch); }
function ensurePresence(scope) {
  const existing = S.presence.get(scope);
  if (existing && !isDeadChannel(existing)) return existing;
  if (existing) { dropChannel(existing); S.presence.delete(scope); }
  const ch = S.sb.channel('voice:' + scope, { config: { private: true, presence: { key: S.user.id + ':' + Math.random().toString(36).slice(2, 8) } } });
  ch.on('presence', { event: 'sync' }, () => onPresenceSync(scope));
  ch.on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(payload));
  ch.on('broadcast', { event: 'refresh' }, () => { if (S.server?.id === scope) loadRoles().then(loadChannels); });
  ch.on('broadcast', { event: 'watch' }, ({ payload }) => onWatchRequest(payload, scope));
  ch.on('broadcast', { event: 'unwatch' }, ({ payload }) => onUnwatch(payload, scope));
  ch.subscribe((st, err) => {
    if (st === 'SUBSCRIBED') { if (S.voice?.serverId === scope) trackVoice(); return; }
    if (st !== 'CLOSED' || ch._intentional) return;
    // o servidor fechou o canal: recria e volta para a chamada com o mesmo estado
    console.warn('canal de presença fechado pelo servidor; reconectando', err?.message || '');
    setTimeout(() => {
      if (S.presence.get(scope) !== ch || !presenceInUse(scope)) return;
      S.presence.delete(scope); dropChannel(ch); ensurePresence(scope);
    }, 1500);
  });
  S.presence.set(scope, ch);
  return ch;
}
function healRealtime() { // confere os canais de tempo real e reconecta o que tiver caído
  if (!S.user || !S.sb) return;
  if (S.dbCh && isDeadChannel(S.dbCh)) { dropChannel(S.dbCh); subscribeDb(); }
  if (S.myOnline && isDeadChannel(S.myOnline)) { dropChannel(S.myOnline); startMyOnline(); }
  if (S.ringCh && isDeadChannel(S.ringCh)) { dropChannel(S.ringCh); subscribeRing(); }
  let lostFriends = false;
  for (const [uid, ch] of [...S.onlineSubs]) if (isDeadChannel(ch)) { dropChannel(ch); S.onlineSubs.delete(uid); lostFriends = true; }
  if (lostFriends) syncOnlineSubs();
  for (const [scope, ch] of [...S.presence]) if (isDeadChannel(ch) && presenceInUse(scope)) { S.presence.delete(scope); dropChannel(ch); ensurePresence(scope); }
}
function releaseUnusedPresence() {
  for (const [scope, ch] of S.presence) {
    const inUse = S.server?.id === scope || S.voice?.serverId === scope || (S.textCh && scopeOf(S.textCh) === scope);
    if (!inUse) { dropChannel(ch); S.presence.delete(scope); }
  }
}
function voiceUsers(scope, channelId) {
  const ch = S.presence.get(scope); if (!ch) return [];
  const byUid = new Map(); // a mesma pessoa aparece uma vez só (mesmo com conexão antiga ou outro aparelho)
  for (const arr of Object.values(ch.presenceState())) for (const p of arr) {
    if (p.voice !== channelId || !p.peerId) continue;
    if (p.peerId === S.peerId && S.voice?.channelId !== channelId) continue; // eu já saí; a presença local ainda não atualizou
    const cur = byUid.get(p.uid);
    if (!cur || p.peerId === S.peerId || (cur.peerId !== S.peerId && (p.at || 0) > (cur.at || 0))) byUid.set(p.uid, p);
  }
  return [...byUid.values()];
}
function onPresenceSync(scope) {
  if (S.server?.id === scope) { renderChannels(); if (S.viewCh?.kind === 'voice') updateVoiceJoinInfo(); }
  if (S.voice?.serverId === scope) onVoiceMembers();
}
async function trackVoice() {
  if (!S.voice) return;
  const ch = S.presence.get(S.voice.serverId);
  if (isDeadChannel(ch)) { ensurePresence(S.voice.serverId); return; } // o canal novo envia a presença ao conectar
  await ch.track({ uid: S.user.id, peerId: S.peerId, voice: S.voice.channelId, mic: !!S.voice.mic && !S.voice.muted && !S.deaf, deaf: S.deaf,
    live: !!S.pubs.screen, watchers: S.pubs.screen ? S.pubs.screen.calls.size : 0, at: S.voice.joinedAt });
}

// ---------- voz ----------
function startPeer() {
  if (S.peer) return;
  const peer = new Peer(PEER_OPTS); S.peer = peer;
  peer.on('open', (id) => { S.peerId = id; });
  peer.on('call', onIncomingCall);
  peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
  peer.on('error', (err) => { if (err.type !== 'peer-unavailable') console.warn('peer', err.type); });
}
function waitPeer() {
  return new Promise((res, rej) => {
    let n = 0; const t = setInterval(() => {
      if (S.peerId && S.peer?.open) { clearInterval(t); res(S.peerId); } else if (++n > 100) { clearInterval(t); rej(new Error('peer')); }
    }, 100);
  });
}
function openVoiceView(ch) {
  S.viewCh = ch; S.textCh = null;
  if (S.server) renderChannels();
  showView('voice');
  const isDM = ch.kind === 'dm';
  $('voice-title').textContent = isDM ? 'Chamada com ' + nameOf(S.dms.get(ch.id)?.other) : ch.name;
  const inside = S.voice?.channelId === ch.id;
  $('voice-join').classList.toggle('hidden', inside);
  $('voice-stage').classList.toggle('hidden', !inside);
  if (!inside) updateVoiceJoinInfo();
}
function updateVoiceJoinInfo() {
  const ch = S.viewCh; if (!ch || (ch.kind !== 'voice' && ch.kind !== 'dm')) return;
  $('voice-join-title').textContent = ch.kind === 'dm' ? 'Chamada com ' + nameOf(S.dms.get(ch.id)?.other) : ch.name;
  const users = voiceUsers(scopeOf(ch), ch.id);
  $('voice-join-who').textContent = users.length ? 'Na chamada: ' + users.map((u) => nameOf(u.uid)).join(', ') : 'Ninguém aqui ainda.';
}
$('btn-join-voice').onclick = () => S.viewCh && joinVoice(S.viewCh);

async function getMic() {
  const a = S.audioPrefs;
  return navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: a.in ? { exact: a.in } : undefined, echoCancellation: a.ec, noiseSuppression: a.ns, autoGainControl: a.agc,
    sampleRate: 48000, channelCount: 1, sampleSize: 16,
  } }).catch((err) => {
    if (a.in && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      S.audioPrefs.in = ''; saveAudioPrefs(); // microfone escolhido sumiu: volta para o padrão
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: a.ec, noiseSuppression: a.ns, autoGainControl: a.agc } });
    }
    throw err;
  });
}
const MIC_HELP = {
  blocked: ['O Windows está bloqueando o microfone', 'O Telao não recebeu permissão para usar o microfone.', [
    'Clique em "Abrir privacidade do microfone".',
    'Ative "Acesso ao microfone".',
    'Ative também "Permitir que aplicativos da área de trabalho acessem seu microfone" (fica mais abaixo na mesma página).',
    'Feche e abra o Telao de novo.']],
  missing: ['Nenhum microfone encontrado', 'O Windows não encontrou um microfone ativo.', [
    'Confira se o microfone ou fone está conectado.',
    'Em "Configurações de som", veja se o dispositivo de entrada está ativado.',
    'No Telao, escolha o microfone em Configurações → Voz e áudio.']],
  busy: ['O microfone está ocupado', 'Outro programa está usando o microfone de forma exclusiva, ou o driver travou.', [
    'Feche programas que usam o microfone (Discord, jogos, OBS, Teams).',
    'Em Configurações de som → seu microfone → Propriedades avançadas, desmarque "Permitir que aplicativos assumam o controle exclusivo".',
    'Desconecte e conecte o microfone de novo e tente outra vez.']],
};
function micErrorKind(err) {
  const n = err?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'blocked';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'missing';
  if (n === 'NotReadableError' || n === 'AbortError' || n === 'TrackStartError') return 'busy';
  return null;
}
function showMicHelp(err) {
  const kind = micErrorKind(err);
  const [title, text, steps] = MIC_HELP[kind] || ['Não foi possível usar o microfone', 'Erro: ' + (err?.name || 'desconhecido') + ' ' + (err?.message || ''), MIC_HELP.busy[2]];
  $('mic-help-title').textContent = !IS_DESKTOP && kind === 'blocked' ? 'O navegador está bloqueando o microfone' : title;
  $('mic-help-text').textContent = text + (S.voice ? ' Você entrou na chamada só para ouvir.' : '');
  const shown = !IS_DESKTOP && kind === 'blocked'
    ? ['Clique no cadeado ao lado do endereço do site.', 'Em "Microfone", escolha "Permitir".', 'Recarregue a página e entre na chamada de novo.']
    : steps;
  $('mic-help-steps').replaceChildren(...shown.map((t) => el('li', null, t)));
  $('mic-help-privacy').classList.toggle('hidden', !IS_DESKTOP); $('mic-help-sound').classList.toggle('hidden', !IS_DESKTOP);
  openModal('modal-mic');
}
$('mic-help-privacy').onclick = () => window.telao?.openMicPrivacy();
$('mic-help-sound').onclick = () => window.telao?.openSoundSettings();
async function joinVoice(ch) {
  if (S.voice?.channelId === ch.id) return openVoiceView(ch);
  if (ch.server_id && !can(PERM.CONNECT)) { toast('Você não tem permissão para entrar neste canal de voz.'); Sound.play('error'); return; }
  if (S.voice) await leaveVoice();
  try { await waitPeer(); } catch { toast('Sem conexão com o servidor de voz. Tente de novo.'); return; }
  let mic = null;
  let micErr = null;
  try { mic = await getMic(); } catch (err) { console.warn('mic', err); micErr = err; }
  const scope = scopeOf(ch); const isDM = ch.kind === 'dm';
  const forced = !isDM && !can(PERM.SPEAK);
  S.voice = { serverId: scope, channelId: ch.id, ch, mic, muted: forced || !!S.preMuted, forced, isDM, perms: isDM ? PERM_ALL : permsOf(S.user.id), joinedAt: Date.now() };
  claimVoice(); // se esta conta estiver numa chamada em outro aparelho, ele sai
  S.prevVoiceIds = new Set(); S.prevLive = new Set(); S.voiceSettled = false;
  setMicTracks();
  ensurePresence(scope); await trackVoice();
  if (mic) { watchSpeaking(S.peerId, mic); await publish('voice', mic); }
  Sound.play('join');
  $('voice-panel').classList.remove('hidden');
  $('vp-where').textContent = isDM ? nameOf(S.dms.get(ch.id)?.other) : ch.name + ' / ' + (S.server?.name || '');
  updateVoiceUI(); openVoiceView(ch); renderUserTiles();
  if (micErr) showMicHelp(micErr);
  else if (forced) toast('Você entrou sem permissão para falar neste canal.');
}
async function leaveVoice() {
  if (!S.voice) return;
  const { serverId } = S.voice;
  stopCallRinging(); // ainda com S.voice, para avisar quem estava sendo chamado
  const ch = S.presence.get(serverId);
  S.preMuted = !!S.voice.muted && !S.voice.forced; // mantém o "silenciado" para a próxima chamada
  S.voice = null; // a partir daqui nada mais atualiza a presença desta chamada
  for (const kind of Object.keys(S.pubs)) unpublish(kind);
  for (const key of [...S.remote.keys()]) removeRemote(key);
  S.analysers.clear(); S.watching.clear(); S.rewatch.clear();
  // a tela atualiza na hora; a saída da presença no servidor vai em seguida
  Sound.play('leave');
  $('voice-panel').classList.add('hidden'); $('tiles').innerHTML = '';
  updateVoiceUI();
  if (S.server?.id === serverId) renderChannels();
  if (S.viewCh && (S.viewCh.kind === 'voice' || S.viewCh.kind === 'dm') && !S.textCh) openVoiceView(S.viewCh);
  if (ch) { try { await ch.untrack(); } catch (e) { console.warn('untrack', e); } }
  releaseUnusedPresence();
}
$('vp-leave').onclick = leaveVoice; $('ctl-leave').onclick = leaveVoice;
$('vp-share').onclick = () => { if (S.pubs.screen) stopShare(); else openPicker(); };

function setMicTracks() { if (S.voice?.mic) S.voice.mic.getAudioTracks().forEach((t) => (t.enabled = !S.deaf && !S.voice.muted)); }
function toggleMute() {
  if (S.deaf) { toggleDeafen(); return; }
  if (!S.voice) { S.preMuted = !S.preMuted; Sound.play(S.preMuted ? 'mute' : 'unmute'); updateVoiceUI(); return; }
  if (S.voice.forced) { toast('Você não tem permissão para falar neste canal.'); Sound.play('error'); return; }
  if (!S.voice.mic) { toast('Microfone indisponível.'); Sound.play('error'); return; }
  S.voice.muted = !S.voice.muted; setMicTracks();
  Sound.play(S.voice.muted ? 'mute' : 'unmute');
  updateVoiceUI(); trackVoice();
}
function toggleDeafen() {
  S.deaf = !S.deaf;
  document.querySelectorAll('audio.remote-audio, .tile video:not(.local)').forEach((a) => (a.muted = S.deaf));
  setMicTracks();
  Sound.play(S.deaf ? 'deafen' : 'undeafen');
  updateVoiceUI(); trackVoice(); renderUserTiles();
}
function updateVoiceUI() {
  const micOff = S.deaf || (S.voice ? (!S.voice.mic || S.voice.muted) : !!S.preMuted);
  for (const id of ['btn-mute', 'ctl-mute']) { setIcon($(id), micOff ? 'micOff' : 'mic'); $(id).classList.toggle('off', micOff); }
  for (const id of ['btn-deafen', 'ctl-deafen']) { setIcon($(id), S.deaf ? 'headphonesOff' : 'headphones'); $(id).classList.toggle('off', S.deaf); }
  const live = !!S.pubs.screen;
  setIcon($('ctl-share'), live ? 'monitorStop' : 'monitor'); $('ctl-share').classList.toggle('live', live);
  setIcon($('vp-share'), live ? 'monitorStop' : 'monitor');
  $('btn-mute').title = micOff ? 'Ativar microfone' : 'Silenciar microfone';
  $('btn-deafen').title = S.deaf ? 'Ativar áudio' : 'Ensurdecer';
  updateCallbar();
}
$('btn-mute').onclick = toggleMute; $('ctl-mute').onclick = toggleMute;
$('btn-deafen').onclick = toggleDeafen; $('ctl-deafen').onclick = toggleDeafen;

function onVoiceMembers() {
  if (!S.voice) return;
  const users = voiceUsers(S.voice.serverId, S.voice.channelId).filter((u) => u.peerId !== S.peerId);
  const ids = new Set(users.map((u) => u.peerId));
  // sons de entrada/saída de outras pessoas
  if (S.voiceSettled) for (const id of ids) if (!S.prevVoiceIds.has(id)) Sound.play('userJoin');
  if (S.voiceSettled) for (const id of S.prevVoiceIds) if (!ids.has(id)) Sound.play('userLeave');
  // som e aviso quando alguém da chamada começa ou para de transmitir
  const liveNow = new Set(users.filter((u) => u.live).map((u) => u.peerId));
  if (S.voiceSettled) {
    for (const u of users) if (u.live && !S.prevLive.has(u.peerId)) { Sound.play('streamStart'); ensureProfiles([u.uid]).then(() => toast(nameOf(u.uid) + ' começou a transmitir a tela')); }
    for (const id of S.prevLive) if (!liveNow.has(id) && ids.has(id)) Sound.play('streamStop');
  }
  S.prevLive = liveNow;
  S.prevVoiceIds = ids; S.voiceSettled = true;
  if (ids.size && S.call?.outgoing) stopCallRinging();
  for (const pub of Object.values(S.pubs)) for (const [id, call] of pub.calls) if (!ids.has(id)) { call.close(); pub.calls.delete(id); }
  for (const [key, r] of [...S.remote]) {
    const [pid, kind] = key.split(':'); if (pid === 'local') continue;
    const u = users.find((x) => x.peerId === pid);
    if (!u) { if (kind === 'screen') S.rewatch.set(pid, Date.now() + 15000); removeRemote(key); } // pode voltar já já
    else if (kind === 'screen' && !u.live && Date.now() - r.at > 3000) removeRemote(key);
  }
  // a voz vai para todos; a tela só para quem pediu para assistir
  for (const [kind, pub] of Object.entries(S.pubs)) if (kind !== 'screen') for (const id of ids) if (!pub.calls.has(id)) callPeer(kind, id);
  for (const id of [...S.watching]) if (!users.some((u) => u.peerId === id && u.live)) S.watching.delete(id);
  tryRewatch();
  ensureProfiles(users.map((u) => u.uid)).then(renderUserTiles);
}
function renderUserTiles() {
  const box = $('tiles'); box.querySelectorAll('.tile.user, .tile.stream-card').forEach((t) => t.remove());
  if (!S.voice) return;
  const users = voiceUsers(S.voice.serverId, S.voice.channelId);
  // cartão "Fulano está ao vivo — Assistir" para cada transmissão que você ainda não está vendo
  for (const u of users) {
    if (!u.live || u.peerId === S.peerId || S.remote.has(u.peerId + ':screen')) continue;
    const p = prof(u.uid);
    const card = el('div', 'tile stream-card');
    const bg = el('div', 'sc-bg'); if (p?.banner_url) bg.style.backgroundImage = `url("${p.banner_url}")`; else bg.style.background = p?.color || '#5865f2';
    const inner = el('div', 'sc-inner');
    const top = el('div', 'sc-top'); top.appendChild(el('span', 'badge-live', 'AO VIVO'));
    if (u.watchers) { const w = el('span', 'sc-watchers'); w.append(icon('eye'), document.createTextNode(String(u.watchers))); top.appendChild(w); }
    const connecting = S.watching.has(u.peerId);
    const btn = el('button', 'sc-btn', connecting ? 'Conectando...' : 'Assistir transmissão'); btn.disabled = connecting;
    btn.onclick = (e) => { e.stopPropagation(); watchStream(u); };
    inner.append(top, avatar(u.uid, 56), el('div', 'sc-name', nameOf(u.uid)), el('div', 'sc-sub', 'está transmitindo a tela'), btn);
    card.append(bg, inner);
    box.prepend(card);
  }
  if (!users.some((u) => u.peerId === S.peerId)) users.unshift({ uid: S.user.id, peerId: S.peerId, mic: S.voice.mic && !S.voice.muted && !S.deaf, deaf: S.deaf });
  for (const u of users) {
    const t = el('div', 'tile user'); t.dataset.peer = u.peerId;
    const p = prof(u.uid);
    const bn = el('div', 'tile-banner'); if (p?.banner_url) bn.style.backgroundImage = `url("${p.banner_url}")`; else bn.style.background = p?.color || '#5865f2';
    const label = el('div', 'label'); label.appendChild(el('span', null, nameOf(u.uid)));
    if (u.deaf) label.appendChild(icon('headphonesOff')); else if (!u.mic) label.appendChild(icon('micOff'));
    t.append(bn, avatar(u.uid, 84, { peer: u.peerId }), label);
    t.onclick = () => openProfile(u.uid);
    box.appendChild(t);
  }
}

async function publish(kind, stream, bitrate) {
  S.pubs[kind] = { stream, calls: new Map(), bitrate };
  await trackVoice();
  if (kind === 'screen') return; // a tela só vai para quem clicar em "Assistir"
  for (const u of voiceUsers(S.voice.serverId, S.voice.channelId)) if (u.peerId !== S.peerId) callPeer(kind, u.peerId);
}
function callPeer(kind, id) {
  const pub = S.pubs[kind]; if (!pub || !S.peer?.open) return;
  const call = S.peer.call(id, pub.stream, { metadata: { kind } }); if (!call) return;
  pub.calls.set(id, call);
  const pc = call.peerConnection;
  if (pc) pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') applyBitrates(pc, kind, pub); });
  const drop = () => {
    if (pub.calls.get(id) !== call) return;
    pub.calls.delete(id);
    if (kind === 'screen' && S.pubs.screen === pub) { updateLiveHud(); trackVoice(); }
  };
  call.on('close', drop); call.on('error', drop);
}
function applyBitrates(pc, kind, pub) {
  for (const s of pc.getSenders()) {
    if (!s.track) continue;
    const prm = s.getParameters(); if (!prm.encodings?.length) prm.encodings = [{}];
    if (s.track.kind === 'video') { prm.encodings[0].maxBitrate = pub.bitrate; prm.degradationPreference = 'maintain-resolution'; }
    else { prm.encodings[0].maxBitrate = kind === 'voice' ? MIC_BITRATE[S.audioPrefs.quality] || MIC_BITRATE.high : SCREEN_AUDIO_BITRATE; prm.encodings[0].priority = 'high'; prm.encodings[0].networkPriority = 'high'; }
    s.setParameters(prm).catch(() => {});
  }
}
function unpublish(kind) {
  const pub = S.pubs[kind]; if (!pub) return;
  delete S.pubs[kind];
  pub.stream.getTracks().forEach((t) => t.stop());
  for (const c of pub.calls.values()) c.close();
  if (kind === 'screen') { removeRemote('local:screen'); stopLiveHud(); }
  trackVoice(); updateVoiceUI();
}
function onIncomingCall(call) {
  if (!S.voice) { call.close(); return; }
  const kind = call.metadata?.kind === 'screen' ? 'screen' : 'voice';
  const key = call.peer + ':' + kind;
  removeRemote(key); call.answer();
  const entry = { call, el: null, at: Date.now() };
  S.remote.set(key, entry);
  call.on('stream', (stream) => {
    if (S.remote.get(key) !== entry) return;
    if (entry.el) { entry.el.querySelector('video,audio').srcObject = stream; return; }
    if (kind === 'voice') { entry.el = audioEl(stream); watchSpeaking(call.peer, stream); }
    else {
      const u = voiceUsers(S.voice.serverId, S.voice.channelId).find((x) => x.peerId === call.peer);
      S.watching.add(call.peer);
      entry.el = screenTile(stream, u ? nameOf(u.uid) : 'Alguém', false, call.peer);
      renderUserTiles();
    }
  });
  call.on('close', () => {
    if (S.remote.get(key) !== entry) return; // já foi removido (ex.: clicou em "Parar de assistir")
    removeRemote(key);
    if (kind === 'screen') autoRewatch(call.peer);
  });
}
// se a transmissão que você assistia cair sozinha, volta a assistir assim que ela estiver disponível de novo
function autoRewatch(peerId) { S.rewatch.set(peerId, Date.now() + 15000); setTimeout(tryRewatch, 1200); }
function tryRewatch() {
  if (!S.voice) return;
  const now = Date.now();
  for (const [pid, until] of [...S.rewatch]) {
    if (until < now) { S.rewatch.delete(pid); continue; }
    const u = voiceUsers(S.voice.serverId, S.voice.channelId).find((x) => x.peerId === pid && x.live);
    if (u && !S.remote.has(pid + ':screen') && !S.watching.has(pid)) { S.rewatch.delete(pid); watchStream(u); }
  }
}
// uma chamada por conta: entrar na voz em outro aparelho tira este da chamada (como no Discord)
function claimVoice() {
  if (S.ringCh && S.voice) S.ringCh.send({ type: 'broadcast', event: 'voice-claim', payload: { device: DEVICE_ID, at: S.voice.joinedAt } });
}
function onVoiceClaim(p) {
  if (!S.voice || !p || p.device === DEVICE_ID || !(p.at > S.voice.joinedAt)) return;
  leaveVoice(); toast('Você entrou na chamada em outro aparelho, então saiu daqui.');
}
function removeRemote(key) {
  const r = S.remote.get(key); if (!r) return;
  S.remote.delete(key); r.call?.close(); r.el?.remove();
  if (key.endsWith(':voice')) S.analysers.delete(key.split(':')[0]);
  if (key.endsWith(':screen') && !key.startsWith('local:')) { S.watching.delete(key.split(':')[0]); if (S.voice) renderUserTiles(); }
}
function applySink(elm) { if (S.audioPrefs.out && elm.setSinkId) elm.setSinkId(S.audioPrefs.out).catch(() => {}); }
function audioEl(stream) {
  const wrap = el('div', 'hidden'); const a = document.createElement('audio');
  a.className = 'remote-audio'; a.autoplay = true; a.srcObject = stream; a.muted = S.deaf; applySink(a);
  wrap.appendChild(a); document.body.appendChild(wrap);
  a.play?.().catch(() => showAudioUnlock());
  return wrap;
}
function screenTile(stream, name, local, peerId) {
  const tile = el('div', 'tile stream-tile');
  const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.srcObject = stream;
  v.muted = local || S.deaf; if (local) v.classList.add('local'); applySink(v);
  const label = el('div', 'label'); label.append(el('span', 'badge-live', 'AO VIVO'), el('span', null, local ? 'Sua transmissão' : name));
  const fs = el('button', 'fs'); fs.title = 'Tela cheia'; fs.appendChild(icon('maximize'));
  fs.onclick = (e) => { e.stopPropagation(); document.fullscreenElement ? document.exitFullscreen() : tile.requestFullscreen(); };
  tile.ondblclick = fs.onclick;
  tile.append(v, label, fs);
  if (!local && peerId) { // quem assiste pode parar quando quiser
    const stop = el('button', 'sw-stop'); stop.title = 'Parar de assistir'; stop.append(icon('x'), el('span', null, 'Parar de assistir'));
    stop.onclick = (e) => { e.stopPropagation(); stopWatching(peerId); };
    tile.appendChild(stop);
  }
  $('tiles').prepend(tile);
  if (!local) v.play?.().catch(() => showAudioUnlock());
  return tile;
}

let audioCtx = null;
function watchSpeaking(peerId, stream) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser(); an.fftSize = 512; src.connect(an);
    S.analysers.set(peerId, an);
  } catch {}
}
const levelBuf = new Uint8Array(512);
setInterval(() => {
  if (!S.analysers.size) return;
  for (const [pid, an] of S.analysers) {
    an.getByteTimeDomainData(levelBuf);
    let peak = 0; for (let i = 0; i < levelBuf.length; i += 4) peak = Math.max(peak, Math.abs(levelBuf[i] - 128));
    const silent = pid === S.peerId && (S.voice?.muted || S.deaf);
    const on = !silent && peak > 12;
    document.querySelectorAll(`[data-peer="${pid}"]`).forEach((a) => a.classList.toggle('speaking', on));
  }
}, 150);

// ---------- chamadas com amigos (toque) ----------
function subscribeRing() {
  const ch = S.sb.channel('ring:' + S.user.id, { config: { private: true } });
  ch.on('broadcast', { event: 'ring' }, ({ payload }) => onRing(payload));
  ch.on('broadcast', { event: 'voice-claim' }, ({ payload }) => onVoiceClaim(payload));
  ch.on('broadcast', { event: 'cancel' }, ({ payload }) => { if (S.incoming?.from === payload.from) closeIncoming(); });
  ch.on('broadcast', { event: 'decline' }, ({ payload }) => {
    if (S.call?.to === payload.from) {
      stopCallRinging(); Sound.play('error'); toast(nameOf(payload.from) + ' recusou a chamada.');
      if (S.voice && !voiceUsers(S.voice.serverId, S.voice.channelId).some((u) => u.uid !== S.user.id)) leaveVoice();
    }
  });
  ch.subscribe();
  S.ringCh = ch;
}
async function sendRing(to, event, payload) {
  const ch = S.sb.channel('ring:' + to, { config: { private: true } });
  try { await ch.httpSend(event, payload); } catch (e) { console.warn('ring', e); }
  S.sb.removeChannel(ch);
}
async function startCall(uid) {
  const dm = await getDM(uid); if (!dm) return;
  if (S.mode !== 'home') goHome();
  await joinVoice(dm);
  if (!S.voice) return;
  const others = voiceUsers(S.voice.serverId, S.voice.channelId).filter((u) => u.uid !== S.user.id);
  if (others.length) return; // a pessoa já está na chamada
  S.call = { to: uid, outgoing: true };
  sendRing(uid, 'ring', { from: S.user.id, dm: dm.id });
  Sound.loop('ringback');
  S.call.timer = setTimeout(() => {
    if (!S.call) return;
    stopCallRinging(); toast('Sem resposta.');
    if (S.voice && !voiceUsers(S.voice.serverId, S.voice.channelId).some((u) => u.uid !== S.user.id)) leaveVoice();
  }, 30000);
}
function stopCallRinging() {
  if (!S.call) return;
  clearTimeout(S.call.timer);
  if (S.call.outgoing && S.voice && !voiceUsers(S.voice.serverId, S.voice.channelId).some((u) => u.uid !== S.user.id)) sendRing(S.call.to, 'cancel', { from: S.user.id });
  S.call = null; Sound.stopLoop();
}
async function onRing(p) {
  if (!p?.from || S.voice?.channelId === p.dm) return;
  await ensureProfiles([p.from]);
  S.incoming = { from: p.from, dm: p.dm };
  $('call-avatar').replaceChildren(avatar(p.from, 96));
  $('call-name').textContent = nameOf(p.from);
  openModal('modal-call');
  if (S.myStatus !== 'dnd') Sound.loop('ring');
  clearTimeout(S.incomingTimer);
  S.incomingTimer = setTimeout(closeIncoming, 30000);
}
function closeIncoming() { S.incoming = null; clearTimeout(S.incomingTimer); Sound.stopLoop(); closeModal('modal-call'); }
$('call-accept').onclick = async () => {
  const inc = S.incoming; closeIncoming(); if (!inc) return;
  const dm = await getDM(inc.from); if (!dm) return;
  if (S.mode !== 'home') goHome();
  joinVoice(dm);
};
$('call-decline').onclick = () => { const inc = S.incoming; closeIncoming(); if (inc) sendRing(inc.from, 'decline', { from: S.user.id }); };

// ---------- Telao Ao Vivo (transmitir tela) ----------
let pickerTab = 'screen', pickerSel = null, pickerSources = [], pickerMode = 'start', pickerQuality = '1080';
let previewStream = null, previewToken = 0, pickerRefresh = null, liveTimer = null;
$('ctl-share').onclick = () => { if (S.pubs.screen) stopShare(); else openPicker('start'); };
$('live-switch').onclick = () => openPicker('switch');
$('live-stop').onclick = () => stopShare();
document.querySelectorAll('#live-tabs .seg-btn').forEach((t) => (t.onclick = () => {
  document.querySelectorAll('#live-tabs .seg-btn').forEach((x) => x.classList.toggle('active', x === t));
  pickerTab = t.dataset.tab; renderSources();
}));
document.querySelectorAll('#live-quality .seg-btn').forEach((b) => (b.onclick = () => {
  pickerQuality = b.dataset.q;
  document.querySelectorAll('#live-quality .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
}));
async function openPicker(mode = 'start') {
  if (!S.voice) { toast('Entre em uma chamada para transmitir.'); return; }
  if (!S.voice.isDM && !(S.voice.perms & PERM.STREAM)) { toast('Você não tem permissão para transmitir neste canal.'); Sound.play('error'); return; }
  if (!IS_DESKTOP && !CAN_SHARE) { toast('Transmitir a tela só funciona no computador.'); return; }
  pickerMode = mode; pickerSel = null;
  $('live-title').textContent = mode === 'switch' ? 'Trocar transmissão' : 'Transmitir ao vivo';
  $('live-sub').textContent = mode === 'switch' ? 'Escolha a nova tela ou janela. A transmissão continua sem cair.' : 'Escolha o que seus amigos vão ver.';
  $('picker-go-text').textContent = mode === 'switch' ? 'Trocar agora' : 'Entrar ao vivo';
  $('live-tabs').classList.toggle('hidden', !IS_DESKTOP);
  showPreview(null);
  openModal('picker');
  if (!IS_DESKTOP) { // no navegador, a escolha da tela é sempre feita pela janela do próprio navegador
    const box = $('sources'); box.innerHTML = '';
    const note = el('div', 'web-share-note');
    note.append(el('b', null, 'Você está no navegador. '), document.createTextNode('Por segurança, todo navegador mostra a janela dele para você escolher a tela, a janela ou a aba. Depois disso, a transmissão segue no formato do Telao.'));
    if (!IS_MOBILE_DEVICE) {
      const dl = el('a', 'download-app dl-link'); dl.href = '#';
      dl.append(icon('download'), document.createTextNode(' No app para Windows essa janela não aparece'));
      note.append(el('br'), dl);
    }
    box.appendChild(note);
    $('lp-empty-text').textContent = 'A prévia aparece depois que você escolher no navegador.';
    $('picker-go').disabled = false;
    return;
  }
  $('picker-go').disabled = true;
  $('sources').innerHTML = '<div class="muted">Carregando...</div>';
  await refreshSources();
  clearInterval(pickerRefresh); pickerRefresh = setInterval(refreshSources, 4000); // miniaturas sempre atualizadas
}
async function refreshSources() {
  if ($('picker').classList.contains('hidden')) { clearInterval(pickerRefresh); return; }
  try { pickerSources = await window.telao.getSources(); } catch { return; }
  if (!$('picker').classList.contains('hidden')) renderSources();
}
function renderSources() {
  const box = $('sources'); box.innerHTML = '';
  const list = pickerSources.filter((s) => (pickerTab === 'screen') === s.isScreen);
  if (!list.length) box.appendChild(el('div', 'muted', pickerTab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta para transmitir.'));
  for (const s of list) {
    const b = el('button', 'source' + (pickerSel === s.id ? ' sel' : ''));
    const thumb = el('div', 'src-thumb');
    if (s.thumb) { const img = document.createElement('img'); img.src = s.thumb; img.alt = ''; thumb.appendChild(img); } else thumb.appendChild(icon('monitor'));
    const cap = el('div', 'src-cap');
    if (s.icon) { const ic = document.createElement('img'); ic.className = 'src-icon'; ic.src = s.icon; ic.alt = ''; cap.appendChild(ic); }
    else cap.appendChild(icon(s.isScreen ? 'monitor' : 'appWindow', 'src-icon'));
    cap.appendChild(el('span', null, s.name));
    b.append(thumb, cap);
    b.onclick = () => selectSource(s.id);
    b.ondblclick = () => { selectSource(s.id); startShare(); };
    box.appendChild(b);
  }
}
async function selectSource(id) {
  if (pickerSel === id) return;
  pickerSel = id; $('picker-go').disabled = false; renderSources();
  const token = ++previewToken;
  stopPreview();
  try { // prévia ao vivo, leve (15 fps), só no seu PC
    await window.telao.chooseSource(id, false);
    const st = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 960 }, frameRate: { ideal: 15 } }, audio: false });
    if (token !== previewToken || $('picker').classList.contains('hidden')) { st.getTracks().forEach((t) => t.stop()); return; }
    previewStream = st; showPreview(st);
  } catch {
    if (token === previewToken) { showPreview(null); $('lp-empty-text').textContent = 'Não deu para mostrar a prévia, mas você ainda pode transmitir.'; }
  }
}
function showPreview(stream) {
  const v = $('live-preview-video'); v.srcObject = stream || null;
  $('lp-empty').classList.toggle('hidden', !!stream);
  if (stream) v.play?.().catch(() => {}); else $('lp-empty-text').textContent = 'Escolha uma tela ou janela para ver a prévia.';
}
function stopPreview() { if (previewStream) { previewStream.getTracks().forEach((t) => t.stop()); previewStream = null; } }
function stopPicker() { clearInterval(pickerRefresh); pickerRefresh = null; previewToken++; stopPreview(); showPreview(null); }
$('picker-go').onclick = () => startShare();

async function captureScreen() { // captura a tela escolhida na qualidade escolhida
  const withAudio = $('share-audio').checked; const q = QUALITY[pickerQuality] || QUALITY['1080'];
  if (IS_DESKTOP) await window.telao.chooseSource(pickerSel, withAudio);
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.frameRate } }, audio: withAudio,
    systemAudio: withAudio ? 'include' : 'exclude', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude',
  });
  const vt = stream.getVideoTracks()[0];
  if (vt) vt.contentHint = q.frameRate >= 60 ? 'motion' : 'detail';
  return { stream, q };
}
async function startShare() {
  if ((IS_DESKTOP && !pickerSel) || !S.voice) return;
  const mode = pickerMode;
  closeModal('picker');
  try {
    const { stream, q } = await captureScreen();
    if (!S.voice) { stream.getTracks().forEach((t) => t.stop()); return; }
    if (mode === 'switch' && S.pubs.screen) { switchShare(stream, q); return; }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (S.pubs.screen?.stream === stream) stopShare(); });
    S.remote.set('local:screen', { call: null, el: screenTile(stream, S.me.name, true), at: Date.now() });
    await publish('screen', stream, q.bitrate);
    startLiveHud(); Sound.play('streamStart'); updateVoiceUI();
  } catch (e) {
    console.error(e);
    if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast('Não foi possível transmitir a tela.');
  }
}
function switchShare(stream, q) { // troca a tela/janela sem derrubar quem está assistindo
  const pub = S.pubs.screen; const old = pub.stream;
  const newV = stream.getVideoTracks()[0], newA = stream.getAudioTracks()[0];
  newV?.addEventListener('ended', () => { if (S.pubs.screen?.stream === stream) stopShare(); });
  pub.stream = stream; pub.bitrate = q.bitrate;
  if (!!newA === old.getAudioTracks().length > 0) {
    for (const c of pub.calls.values()) {
      const pc = c.peerConnection; if (!pc) continue;
      for (const s of pc.getSenders()) {
        if (s.track?.kind === 'video' && newV) s.replaceTrack(newV).catch(() => {});
        else if (s.track?.kind === 'audio' && newA) s.replaceTrack(newA).catch(() => {});
      }
      applyBitrates(pc, 'screen', pub);
    }
  } else { // passou a ter (ou deixou de ter) som: reconecta quem está assistindo
    const watchers = [...pub.calls.keys()];
    for (const c of pub.calls.values()) c.close();
    pub.calls.clear();
    for (const id of watchers) callPeer('screen', id);
  }
  old.getTracks().forEach((t) => t.stop());
  const local = S.remote.get('local:screen'); if (local?.el) local.el.querySelector('video').srcObject = stream;
  Sound.play('click'); toast('Transmissão trocada.');
}
function stopShare() { if (!S.pubs.screen) return; unpublish('screen'); Sound.play('streamStop'); }

// painel AO VIVO de quem transmite
function startLiveHud() {
  S.liveStart = Date.now(); $('live-hud').classList.remove('hidden'); updateLiveHud();
  clearInterval(liveTimer); liveTimer = setInterval(updateLiveHud, 1000);
}
function stopLiveHud() { clearInterval(liveTimer); liveTimer = null; $('live-hud').classList.add('hidden'); }
function updateLiveHud() {
  if (!S.pubs.screen) return;
  const s = Math.floor((Date.now() - (S.liveStart || Date.now())) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  $('live-timer').textContent = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
  $('live-viewers').textContent = String(S.pubs.screen.calls.size);
}

// assistir é opcional (como no Discord): o vídeo só chega para quem pede
function watchStream(u) {
  if (!S.voice) return;
  S.watching.add(u.peerId);
  S.presence.get(S.voice.serverId)?.send({ type: 'broadcast', event: 'watch', payload: { target: u.peerId, viewer: S.peerId } });
  renderUserTiles();
  setTimeout(() => {
    if (S.watching.has(u.peerId) && !S.remote.has(u.peerId + ':screen')) { S.watching.delete(u.peerId); renderUserTiles(); toast('Não foi possível abrir a transmissão. Tente de novo.'); }
  }, 12000);
}
function stopWatching(peerId) {
  S.watching.delete(peerId); S.rewatch.delete(peerId);
  if (S.voice) S.presence.get(S.voice.serverId)?.send({ type: 'broadcast', event: 'unwatch', payload: { target: peerId, viewer: S.peerId } });
  removeRemote(peerId + ':screen');
}
function onWatchRequest(p, scope) {
  if (!S.voice || S.voice.serverId !== scope || !p || p.target !== S.peerId || !S.pubs.screen) return;
  if (!voiceUsers(scope, S.voice.channelId).some((u) => u.peerId === p.viewer)) return; // só quem está na mesma chamada
  if (S.pubs.screen.calls.has(p.viewer)) return;
  callPeer('screen', p.viewer); Sound.play('watchJoin'); updateLiveHud(); trackVoice();
}
function onUnwatch(p, scope) {
  if (!S.voice || S.voice.serverId !== scope || !p || p.target !== S.peerId || !S.pubs.screen) return;
  const c = S.pubs.screen.calls.get(p.viewer);
  if (c) { S.pubs.screen.calls.delete(p.viewer); c.close(); }
  updateLiveHud(); trackVoice();
}

// ---------- configurações ----------
let draft = null;
function openSettings(section = 'profile') {
  draft = { name: S.me.name, bio: S.me.bio || '', color: S.me.color || '#5865f2', avatar_url: S.me.avatar_url, banner_url: S.me.banner_url };
  $('pe-name').value = draft.name; $('pe-bio').value = draft.bio; $('pe-color').value = draft.color; $('pe-status').value = S.myStatus;
  $('pe-msg').textContent = ''; $('acc-msg').textContent = ''; $('acc-pass1').value = ''; $('acc-pass2').value = '';
  $('acc-handle').textContent = '@' + S.me.username;
  $('snd-on').checked = Sound.enabled; $('snd-vol').value = Sound.volume;
  $('mic-quality').value = S.audioPrefs.quality; $('opt-ns').checked = S.audioPrefs.ns; $('opt-ec').checked = S.audioPrefs.ec; $('opt-agc').checked = S.audioPrefs.agc;
  renderDraftCard(); setSettingsSection(section); openModal('modal-settings');
}
function setSettingsSection(s) {
  document.querySelectorAll('.sn[data-sn]').forEach((b) => b.classList.toggle('active', b.dataset.sn === s));
  document.querySelectorAll('section[data-sp]').forEach((x) => x.classList.toggle('hidden', x.dataset.sp !== s));
  if (s === 'voice') loadDevices(); else stopMicTest();
  if (s === 'advanced') loadAdvanced();
}
document.querySelectorAll('.sn[data-sn]').forEach((b) => (b.onclick = () => setSettingsSection(b.dataset.sn)));
$('btn-settings').onclick = () => openSettings('profile');
function renderDraftCard() {
  const p = { ...S.me, ...draft };
  S.profiles.set(S.me.id, p); // prévia usa o rascunho
  $('pe-card').replaceChildren(profileCard(p));
  S.profiles.set(S.me.id, S.me);
}
for (const id of ['pe-name', 'pe-bio', 'pe-color']) $(id).addEventListener('input', () => {
  draft.name = $('pe-name').value; draft.bio = $('pe-bio').value; draft.color = $('pe-color').value; renderDraftCard();
});
$('pe-avatar-btn').onclick = () => $('file-avatar').click();
$('pe-banner-btn').onclick = () => $('file-banner').click();
$('pe-avatar-rm').onclick = () => { draft.avatar_url = null; renderDraftCard(); };
$('pe-banner-rm').onclick = () => { draft.banner_url = null; renderDraftCard(); };
$('file-avatar').onchange = (e) => handleUpload(e.target, 'avatar');
$('file-banner').onchange = (e) => handleUpload(e.target, 'banner');
async function handleUpload(input, kind) {
  const file = input.files[0]; input.value = ''; if (!file) return;
  $('pe-msg').className = 'small'; $('pe-msg').textContent = 'Enviando...';
  try {
    const url = await uploadImage(file, kind);
    draft[kind === 'avatar' ? 'avatar_url' : 'banner_url'] = url; renderDraftCard();
    $('pe-msg').textContent = 'Imagem carregada. Clique em "Salvar alterações".';
  } catch (e) { $('pe-msg').className = 'small error'; $('pe-msg').textContent = e.message || 'Erro ao enviar imagem.'; }
}
async function uploadImage(file, kind) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Use PNG, JPG, GIF ou WEBP.');
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem precisa ter até 8 MB.');
  let blob = file, ext = file.type.split('/')[1].replace('jpeg', 'jpg'), type = file.type;
  if (file.type !== 'image/gif') { // GIF mantém a animação; os demais são redimensionados
    const [w, h] = kind === 'banner' ? [960, 384] : [256, 256];
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const s = Math.max(w / bmp.width, h / bmp.height);
    c.getContext('2d').drawImage(bmp, (w - bmp.width * s) / 2, (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9)); ext = 'webp'; type = 'image/webp';
  }
  const path = `${S.user.id}/${kind}-${Date.now()}.${ext}`;
  const { error } = await S.sb.storage.from('avatars').upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error('Erro ao enviar a imagem.');
  return S.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
$('pe-save').onclick = async () => {
  const name = $('pe-name').value.trim();
  if (!name) { $('pe-msg').className = 'small error'; $('pe-msg').textContent = 'O nome não pode ficar vazio.'; return; }
  const upd = { name: name.slice(0, 24), bio: $('pe-bio').value.slice(0, 190), color: $('pe-color').value, avatar_url: draft.avatar_url, banner_url: draft.banner_url };
  const { data, error } = await S.sb.from('profiles').update(upd).eq('id', S.user.id).select().single();
  if (error) { $('pe-msg').className = 'small error'; $('pe-msg').textContent = 'Erro ao salvar.'; return; }
  S.me = data; cacheProfile(data);
  const st = $('pe-status').value;
  if (st !== S.myStatus) { S.myStatus = st; store.set('telao-status', st); trackMyStatus(); }
  renderMe(); renderUserTiles(); if (S.mode === 'server') renderMembers();
  $('pe-msg').className = 'small ok-text'; $('pe-msg').textContent = 'Perfil salvo!';
};
$('acc-pass-save').onclick = async () => {
  const a = $('acc-pass1').value, b = $('acc-pass2').value, msg = $('acc-msg');
  msg.className = 'small error';
  if (a.length < 6) { msg.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
  if (a !== b) { msg.textContent = 'As senhas não são iguais.'; return; }
  const { error } = await S.sb.auth.updateUser({ password: a });
  if (error) { msg.textContent = 'Erro ao trocar a senha.'; return; }
  $('acc-pass1').value = ''; $('acc-pass2').value = '';
  msg.className = 'small ok-text'; msg.textContent = 'Senha alterada!';
};
$('btn-logout').onclick = async () => {
  if (!(await confirmBox('Sair da conta', 'Deseja sair da sua conta neste PC?', 'Sair'))) return;
  await leaveVoice(); await S.sb.auth.signOut(); location.reload();
};
$('snd-on').onchange = () => { Sound.enabled = $('snd-on').checked; };
$('snd-vol').oninput = () => { Sound.volume = parseFloat($('snd-vol').value); };
document.querySelectorAll('[data-test]').forEach((b) => (b.onclick = () => Sound.play(b.dataset.test)));

function saveAudioPrefs() { store.set('telao-audio', S.audioPrefs); }
async function loadDevices() {
  let devs = await navigator.mediaDevices.enumerateDevices();
  if (devs.some((d) => d.kind === 'audioinput' && !d.label)) {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
  }
  const fill = (sel, kind, cur) => {
    sel.innerHTML = '';
    sel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: 'Padrão do sistema' }));
    for (const d of devs.filter((x) => x.kind === kind && x.deviceId !== 'default' && x.deviceId !== 'communications'))
      sel.appendChild(Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label || 'Dispositivo' }));
    sel.value = cur || '';
  };
  fill($('dev-in'), 'audioinput', S.audioPrefs.in);
  fill($('dev-out'), 'audiooutput', S.audioPrefs.out);
}
$('dev-in').onchange = () => { S.audioPrefs.in = $('dev-in').value; saveAudioPrefs(); if (micTest) startMicTest(); };
$('dev-out').onchange = () => {
  S.audioPrefs.out = $('dev-out').value; saveAudioPrefs();
  document.querySelectorAll('audio.remote-audio, .tile video').forEach(applySink);
};
$('mic-quality').onchange = () => {
  S.audioPrefs.quality = $('mic-quality').value; saveAudioPrefs();
  const pub = S.pubs.voice; if (pub) for (const c of pub.calls.values()) if (c.peerConnection) applyBitrates(c.peerConnection, 'voice', pub);
  toast('Qualidade do microfone: ' + $('mic-quality').selectedOptions[0].textContent.split(' —')[0]);
};
for (const [id, key] of [['opt-ns', 'ns'], ['opt-ec', 'ec'], ['opt-agc', 'agc']]) $(id).onchange = () => { S.audioPrefs[key] = $(id).checked; saveAudioPrefs(); };
let micTest = null;
async function startMicTest() {
  stopMicTest();
  try {
    const stream = await getMic();
    audioCtx = audioCtx || new AudioContext();
    const an = audioCtx.createAnalyser(); an.fftSize = 512; audioCtx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(512);
    const timer = setInterval(() => {
      an.getByteTimeDomainData(buf); let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      $('mic-meter').style.width = Math.min(100, peak * 1.6) + '%';
    }, 80);
    micTest = { stream, timer }; $('mic-test').textContent = 'Parar teste';
  } catch (err) { showMicHelp(err); }
}
function stopMicTest() {
  if (!micTest) return;
  clearInterval(micTest.timer); micTest.stream.getTracks().forEach((t) => t.stop()); micTest = null;
  $('mic-meter').style.width = '0'; $('mic-test').textContent = 'Testar microfone';
}
$('mic-test').onclick = () => (micTest ? stopMicTest() : startMicTest());

async function loadAdvanced() {
  const cfg = window.telao?.getConfig ? await window.telao.getConfig() : { hwAccel: true, compatCapture: false };
  $('adv-compat').checked = !!cfg.compatCapture; $('adv-hw').checked = cfg.hwAccel !== false;
  $('adv-version').textContent = cfg.version ? 'Telao versão ' + cfg.version : '';
}
async function saveAdvanced() {
  await window.telao?.setConfig({ compatCapture: $('adv-compat').checked, hwAccel: $('adv-hw').checked });
  $('adv-restart').classList.remove('hidden');
}
$('adv-compat').onchange = saveAdvanced; $('adv-hw').onchange = saveAdvanced;
$('adv-restart').onclick = async () => { await leaveVoice(); window.telao?.relaunch(); };
$('adv-privacy').onclick = () => window.telao?.openMicPrivacy();
$('adv-diag').onclick = async () => {
  const out = $('adv-diag-out'); out.classList.remove('hidden'); out.textContent = 'Testando...';
  const lines = [];
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    lines.push('Microfones encontrados: ' + devs.filter((d) => d.kind === 'audioinput').length);
    lines.push('Saídas de áudio: ' + devs.filter((d) => d.kind === 'audiooutput').length);
  } catch (e) { lines.push('Não foi possível listar dispositivos: ' + e.name); }
  try {
    const st = await getMic(); const t = st.getAudioTracks()[0];
    lines.push('Microfone: OK — ' + (t?.label || 'sem nome') + ' (' + (t?.getSettings().sampleRate || '?') + ' Hz)');
    st.getTracks().forEach((x) => x.stop());
  } catch (e) { const k = micErrorKind(e); lines.push('Microfone: FALHOU — ' + e.name + (k ? ' (' + MIC_HELP[k][0] + ')' : '')); }
  try {
    const src = window.telao ? await window.telao.getSources() : [];
    lines.push('Telas para transmitir: ' + src.filter((x) => x.isScreen).length + ' • Janelas: ' + src.filter((x) => !x.isScreen).length);
    lines.push('Miniaturas vazias: ' + src.filter((x) => !x.thumb).length);
  } catch (e) { lines.push('Captura de tela: FALHOU — ' + e.message); }
  const cfg = window.telao?.getConfig ? await window.telao.getConfig() : {};
  lines.push('Modo compatível: ' + (cfg.compatCapture ? 'ligado' : 'desligado') + ' • Aceleração de hardware: ' + (cfg.hwAccel === false ? 'desligada' : 'ligada'));
  out.textContent = lines.join('\n');
};

// barra de atualização automática
window.telao?.onUpdate?.((d) => {
  document.body.classList.add('has-update'); $('update-bar').classList.remove('hidden');
  if (d.state === 'downloading') $('update-text').textContent = 'Baixando atualização ' + (d.version || '') + '...';
  if (d.state === 'progress') $('update-text').textContent = 'Baixando atualização... ' + d.percent + '%';
  if (d.state === 'ready') {
    $('update-text').textContent = 'A versão ' + (d.version || 'nova') + ' está pronta!';
    $('update-btn').classList.remove('hidden'); Sound.play('notify');
  }
});
$('update-btn').onclick = async () => { await leaveVoice(); window.telao.installUpdate(); };

// Ao fechar ou recarregar: sai da chamada e fecha a conexão na hora, para os outros não continuarem te vendo
function leaveOnExit() {
  try {
    if (S.voice) S.presence.get(S.voice.serverId)?.untrack();
    S.myOnline?.untrack();
    S.sb?.realtime?.disconnect();
  } catch {}
  S.peer?.destroy();
}
window.addEventListener('beforeunload', leaveOnExit);
window.addEventListener('pagehide', leaveOnExit);
boot();

#!/usr/bin/env python3
"""One-shot v24 stabilization migration.

This script starts from the current v23 single-file production build, applies
reviewed bug/UX/netcode/accessibility fixes, removes production-only test hooks,
then extracts the monolith into maintained source files. It is intentionally
assertion-heavy: a source drift causes a hard failure instead of a partial edit.
"""
from __future__ import annotations

from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
SRC = ROOT / "src"
ASSETS = ROOT / "assets"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, repl: str, label: str, flags: int = 0) -> str:
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex match, found {count}")
    return out


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


html = INDEX.read_text(encoding="utf-8")
if 'data-build="v24-stabilized"' in html:
    print("v24 migration already applied; nothing to do")
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# HEAD / metadata / installability
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    "allow browser zoom",
)
html = replace_once(
    html,
    '<title>Atelier Air Hockey</title>',
    '''<title>Atelier Air Hockey</title>\n<meta name="description" content="A handcrafted browser air-hockey game with nine art-directed tables, local rivals, two-player play, and peer-to-peer online matches.">\n<meta name="theme-color" content="#070606">\n<meta name="color-scheme" content="dark">\n<link rel="canonical" href="https://builtbysai.com/atelier-air-hockey/">\n<link rel="manifest" href="./manifest.webmanifest">\n<link rel="icon" type="image/png" sizes="192x192" href="./assets/icon-192.png">\n<link rel="apple-touch-icon" href="./assets/icon-192.png">\n<meta property="og:type" content="website">\n<meta property="og:title" content="Atelier Air Hockey">\n<meta property="og:description" content="Nine handcrafted tables. Local, two-player, and peer-to-peer online air hockey in the browser.">\n<meta property="og:url" content="https://builtbysai.com/atelier-air-hockey/">\n<meta property="og:image" content="https://builtbysai.com/atelier-air-hockey/docs/screenshots/d1-menu.png">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="Atelier Air Hockey">\n<meta name="twitter:description" content="Nine handcrafted tables. Local, two-player, and peer-to-peer online air hockey in the browser.">\n<meta name="twitter:image" content="https://builtbysai.com/atelier-air-hockey/docs/screenshots/d1-menu.png">''',
    "add metadata",
)
html = html.replace('<html lang="en">', '<html lang="en" data-build="v24-stabilized">', 1)

# ---------------------------------------------------------------------------
# CSS correctness, hierarchy, focus, reduced motion
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    '#winov .card{ position:relative; overflow:hidden; }',
    '#winov .card{ position:relative; overflow-x:hidden; overflow-y:auto; }',
    "win card overflow",
)
html = replace_once(
    html,
    '''  @media (max-width:480px){\n    .card{ padding:20px 16px; }\n    .overlay{ padding:10px; align-items:flex-start; }\n  }''',
    '''  @media (max-width:480px){\n    .overlay{ padding:10px; }\n  }''',
    "remove conflicting mobile card override",
)
html = replace_once(
    html,
    '  .btn.primary small{ color:var(--btnink); opacity:0.75; }',
    '''  .btn.primary small{ color:var(--btnink); opacity:0.75; }\n  .btn.selected{ background:var(--ghost); color:var(--title); border-color:var(--btnbg); box-shadow:inset 0 0 0 1px var(--btnbg); font-weight:700; }\n  .btn.selected small{ color:var(--sub); opacity:1; }\n  button:focus-visible, a:focus-visible, .tslide:focus-visible, input:focus-visible{ outline:3px solid var(--btnbg); outline-offset:3px; }\n  .invite-actions{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }\n  .invite-actions .btn{ margin:0; padding:10px 8px; font-size:13px; }\n  .progress-list{ text-align:left; display:grid; gap:8px; margin:12px 0 18px; }\n  .progress-item{ display:flex; justify-content:space-between; gap:14px; padding:9px 0; border-bottom:1px solid color-mix(in srgb,var(--pline) 45%,transparent); }\n  .progress-item span:last-child{ color:var(--sub); text-align:right; }''',
    "selection and focus styles",
)
html = replace_once(
    html,
    '  @keyframes cfall{ to{ transform:translateY(110vh) rotate(720deg); opacity:0.85; } }',
    '''  @keyframes cfall{ to{ transform:translateY(110vh) rotate(720deg); opacity:0.85; } }\n  @media (prefers-reduced-motion: reduce){\n    *, *::before, *::after{ scroll-behavior:auto !important; }\n    .pulse, .confetti{ animation:none !important; }\n    .tslide, .cdots i{ transition:none !important; }\n  }''',
    "reduced motion coverage",
)

# ---------------------------------------------------------------------------
# Copy / labels / footer / progression and result-sharing affordances
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    '<div class="foot lobfoot"><button id="btnHelp">How to play</button><button id="btnSettings">Settings</button><a href="https://github.com/builtbysai/atelier-air-hockey" target="_blank" rel="noopener">GitHub</a><span class="ver">v23</span></div>',
    '<div class="foot lobfoot"><button id="btnHelp">How to play</button><button id="btnSettings">Settings</button><button id="btnProgress">Progress</button><a href="https://github.com/builtbysai/atelier-air-hockey" target="_blank" rel="noopener">GitHub</a><a href="https://builtbysai.com/" target="_blank" rel="noopener">Built by Sai</a><span class="ver">1.0.0</span></div>',
    "footer cleanup",
)
html = replace_once(
    html,
    '<p><b>Keys:</b> P pause &middot; M mute &middot; Esc menu.</p>',
    '<p><b>Keys:</b> P pause &middot; M mute &middot; Esc pause/resume. In two-player mode, use WASD and the arrow keys.</p>',
    "help keyboard copy",
)
html = html.replace('id="helpClose" style="width:auto;padding:10px 34px;margin:14px auto 0;">Back to the table</button>', 'id="helpClose" style="width:auto;padding:10px 34px;margin:14px auto 0;">Back</button>', 1)
html = html.replace('id="settingsClose" style="margin-top:16px">Back to the table</button>', 'id="settingsClose" style="margin-top:16px">Done</button>', 1)
html = replace_once(
    html,
    '<button class="btn" id="btnWinMenu">Change table</button>',
    '<button class="btn" id="btnShareResult">Share result</button>\n    <button class="btn" id="btnWinMenu">Change table</button>',
    "share result control",
)
progress_markup = '''\n<div class="overlay hidden" id="progress" role="dialog" aria-modal="true" aria-labelledby="progressTitle">\n  <div class="card">\n    <div class="kicker">TABLE PASSPORT</div>\n    <h1 id="progressTitle">Progress</h1>\n    <p class="tagline" id="progressSummary"></p>\n    <div id="progressBody" class="progress-list"></div>\n    <button class="btn" id="btnResetProgress">Reset progress</button>\n    <button class="btn primary" id="progressClose">Done</button>\n  </div>\n</div>\n'''
html = replace_once(html, '\n<div class="overlay hidden" id="help">', progress_markup + '\n<div class="overlay hidden" id="help">', "progress dialog")

# ---------------------------------------------------------------------------
# Scoreboards / match stats correctness
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    '      const N = 11, scores = [s0, s1];',
    '      const N = Math.max(11, target + 1), scores = [s0, s1];',
    "cribbage first-to-11 support",
)
html = replace_once(
    html,
    '        digit(shown, cx - dw / 2 + cell / 2, y + 16, cell, animK, i * 17);',
    '''        const chars = String(Math.max(0, Math.min(99, Math.round(shown))));\n        const dc = chars.length > 1 ? 6 : cell;\n        const totalW = chars.length * (5 * dc) + Math.max(0, chars.length - 1) * dc;\n        chars.split('').forEach((ch, di) =>\n          digit(+ch, cx - totalW / 2 + dc / 2 + di * 6 * dc, y + 16 + (chars.length > 1 ? 9 : 0), dc, animK, i * 17 + di));''',
    "bulb two-digit rendering",
)
html = replace_once(
    html,
    'function freshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, saves: [0, 0], t0: 0, streak: [0, 0], bestStreak: 0, worstDef: [0, 0] }; }',
    'function freshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, saves: [0, 0], t0: 0, streak: [0, 0], bestStreak: [0, 0], worstDef: [0, 0] }; }',
    "per-side best streak state",
)
html = replace_once(
    html,
    '    if (st.streak[scorer] > st.bestStreak) st.bestStreak = st.streak[scorer];',
    '    if (st.streak[scorer] > st.bestStreak[scorer]) st.bestStreak[scorer] = st.streak[scorer];',
    "per-side streak update",
)
html = replace_once(
    html,
    "        if ((st.bestStreak || 0) >= 3 && Feats.unlock('hattrick')) fresh.push('HAT-TRICK');",
    "        if (((st.bestStreak || [0, 0])[G.winSide] || 0) >= 3 && Feats.unlock('hattrick')) fresh.push('HAT-TRICK');",
    "hat-trick winner attribution",
)

# ---------------------------------------------------------------------------
# Selection semantics / settings semantics / sound accessibility
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    '''  document.querySelectorAll('[data-diff]').forEach(b =>\n    b.classList.toggle('primary', mode === 'ai' && +b.dataset.diff === MenuSel.diff));\n  $('btn2p').classList.toggle('primary', mode === '2p');''',
    '''  document.querySelectorAll('[data-diff]').forEach(b => {\n    const selected = mode === 'ai' && +b.dataset.diff === MenuSel.diff;\n    b.classList.toggle('selected', selected);\n    b.setAttribute('aria-pressed', selected ? 'true' : 'false');\n  });\n  $('btn2p').classList.toggle('selected', mode === '2p');\n  $('btn2p').setAttribute('aria-pressed', mode === '2p' ? 'true' : 'false');''',
    "distinct selection state",
)
html = replace_once(
    html,
    '''  document.querySelectorAll('[data-set]').forEach(btn => {\n    btn.classList.toggle('sel', String(Settings[btn.dataset.set]) === btn.dataset.val);\n  });''',
    '''  document.querySelectorAll('[data-set]').forEach(btn => {\n    const selected = String(Settings[btn.dataset.set]) === btn.dataset.val;\n    btn.classList.toggle('sel', selected);\n    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');\n  });''',
    "settings aria pressed",
)
html = replace_once(
    html,
    "    sb.innerHTML = Settings.sound ? '&#9834;' : '&#215;';",
    "    sb.innerHTML = Settings.sound ? '&#9834;' : '&#215;';\n    sb.setAttribute('aria-label', Settings.sound ? 'Mute sound' : 'Unmute sound');\n    sb.title = Settings.sound ? 'Mute sound (M)' : 'Unmute sound (M)';",
    "sound accessible state",
)

# ---------------------------------------------------------------------------
# Carousel accessibility and persistence
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    "  const track = $('carTrack'), dots = $('carDots');\n  if (!track || track.children.length) return;",
    "  const track = $('carTrack'), dots = $('carDots');\n  if (!track || track.children.length) return;\n  track.setAttribute('role', 'listbox'); track.setAttribute('aria-label', 'Table selection');\n  if (dots) dots.setAttribute('aria-hidden', 'true');",
    "carousel semantics",
)
html = replace_once(
    html,
    "  G.themeId = id; // the tour tracker needs to know which table just hosted a win",
    "  G.themeId = id; // the tour tracker needs to know which table just hosted a win\n  if (!silent) {\n    try {\n      localStorage.setItem('atelier-ah-theme', id);\n      const u = new URL(location.href); u.searchParams.set('table', id);\n      history.replaceState(null, '', u.pathname + u.search + u.hash);\n    } catch (e) { console.warn('Could not persist table selection', e); }\n  }",
    "persist selected table",
)

# ---------------------------------------------------------------------------
# Netcode hardening: selected peer, async cancellation, validation, idempotence
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    '''  code: null,          // 4-letter room code\n  waitingForRival: false,''',
    '''  code: null,          // 6-character room code\n  waitingForRival: false,\n  peerId: null,        // the one accepted rival; all other peers are ignored\n  opToken: 0,          // invalidates async create/join work after Cancel''',
    "net lifecycle fields",
)
# Remove production dev plumbing fields while preserving real plumbing.
html = replace_once(
    html,
    '''  // ---- plumbing ----\n  roomFactory: null,   // stub injection (dev only)\n  stubMode: false,     // forced loopback (dev only)\n  useLoopback: false,  // set by ?netstub at boot (dev only)\n  _trystero: null,     // cached dynamic import\n  joinTimer: 0,\n  offerSent: false,    // rematch offer already sent this win screen\n  botM1: null,         // dev only: AI brain driving the host mallet (stub tests)''',
    '''  // ---- plumbing ----\n  _trystero: null,     // cached dynamic import\n  joinTimer: 0,\n  offerSent: false     // rematch offer already sent this win screen''',
    "remove dev net state",
)
html = replace_once(html, 'for (let i = 0; i < 4; i++)', 'for (let i = 0; i < 6; i++)', "six character room codes")
html = replace_once(
    html,
    '''/* Dynamic import — the ONLY network touch, and only after the user taps\n * Online. Cached after first use. Skipped entirely in stub/loopback mode. */\nNet.trystero = async function () {\n  if (Net.roomFactory || Net.stubMode || Net.useLoopback) return {};\n  if (!Net._trystero) Net._trystero = await import('https://esm.run/trystero@0.25.4');\n  return Net._trystero;\n};''',
    '''/* Dynamic import — the only network touch, and only after Online is used. */\nNet.trystero = async function () {\n  if (!('RTCPeerConnection' in window) || !window.crypto || !crypto.subtle)\n    throw new Error('This browser does not support the WebRTC features required for online play.');\n  if (!Net._trystero) Net._trystero = await import('https://esm.run/trystero@0.25.4');\n  return Net._trystero;\n};''',
    "remove stub import branch",
)
html = replace_once(
    html,
    '''Net.makeRoom = async function (joinRoom, code) {\n  // Dev/test injection wins — the factory's room is used as-is (the old code\n  // ignored the factory's return value and built an unrelated pair).\n  if (Net.roomFactory) return Net.roomFactory();\n  if (Net.stubMode || Net.useLoopback) return Net.createStubPair(15).a;\n  const turn = await Net.turnCredential();''',
    '''Net.makeRoom = async function (joinRoom, code) {\n  const turn = await Net.turnCredential();''',
    "remove stub room branch",
)
html = replace_once(
    html,
    '''  recvSt((data) => { try { h.onSt(data); } catch (e) { Net.logErr(e); } });\n  recvIn((data) => { try { h.onIn(data); } catch (e) { Net.logErr(e); } });\n  recvEv((data) => { try { h.onEv(data); } catch (e) { Net.logErr(e); } });''',
    '''  recvSt((data, peerId) => { try { h.onSt(data, peerId); } catch (e) { Net.logErr(e); } });\n  recvIn((data, peerId) => { try { h.onIn(data, peerId); } catch (e) { Net.logErr(e); } });\n  recvEv((data, peerId) => { try { h.onEv(data, peerId); } catch (e) { Net.logErr(e); } });''',
    "preserve peer identity",
)
html = replace_once(
    html,
    "Net.logErr = function (e) { if (window.__errs) window.__errs.push({ msg: 'net: ' + (e && e.message) }); };",
    "Net.logErr = function (e) { console.warn('[Atelier net]', e); };",
    "surface net errors",
)
html = html.replace("maxlength=\"4\"", "maxlength=\"6\"", 1)
html = html.replace("share the 4-letter code", "share the 6-character code", 1)
html = html.replace("Enter the 4-letter code", "Enter the 6-character code", 1)
html = replace_once(
    html,
    '''    setBtn(P, 'Knock', () => Net.join(($('onlineCodeInput') || {}).value || ''));\n    setBtn(Q, 'Back', () => Net.uiShow('choose'));\n    setTimeout(() => { try { $('onlineCodeInput').focus({ preventScroll: true }); } catch (e) {} }, 60);''',
    '''    setBtn(P, 'Knock', () => Net.join(($('onlineCodeInput') || {}).value || ''));\n    setBtn(Q, 'Back', () => Net.uiShow('choose'));\n    setTimeout(() => {\n      try {\n        const input = $('onlineCodeInput');\n        input.focus({ preventScroll: true });\n        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); P.click(); } });\n      } catch (e) { console.warn('Could not focus code field', e); }\n    }, 60);''',
    "join on enter",
)
html = replace_once(
    html,
    '''  } else if (mode === 'waiting') {\n    T.textContent = 'Table hosted';\n    S.textContent = 'Share this code with your rival.';\n    B.innerHTML = '<div class="online-code">' + (data.code || '····') + '</div>' +\n      '<p class="online-note pulse">Waiting for a rival&hellip;</p>';\n    setBtn(P, 'Cancel', () => Net.cancelLobby());\n    setBtn(Q, null);''',
    '''  } else if (mode === 'opening') {\n    T.textContent = 'Opening table';\n    S.textContent = 'Preparing a secure peer-to-peer room.';\n    B.innerHTML = '<p class="online-note pulse">Connecting&hellip;</p>';\n    setBtn(P, 'Cancel', () => Net.cancelLobby());\n    setBtn(Q, null);\n  } else if (mode === 'waiting') {\n    T.textContent = 'Table hosted';\n    S.textContent = 'Share this code with your rival.';\n    B.innerHTML = '<div class="online-code">' + (data.code || '······') + '</div>' +\n      '<div class="invite-actions"><button class="btn" id="copyInvite">Copy invite</button><button class="btn" id="shareInvite">Share invite</button></div>' +\n      '<p class="online-note pulse">Waiting for a rival&hellip;</p>';\n    setBtn(P, 'Cancel', () => Net.cancelLobby());\n    setBtn(Q, null);\n    const copy = $('copyInvite'), share = $('shareInvite');\n    if (copy) copy.onclick = () => Net.copyInvite(data.code || '');\n    if (share) {\n      share.classList.toggle('hidden', !navigator.share);\n      share.onclick = () => Net.shareInvite(data.code || '');\n    }''',
    "online opening and invite actions",
)
invite_helpers = '''\nNet.inviteUrl = function (code) {\n  const u = new URL(location.href);\n  u.search = ''; u.hash = '';\n  u.searchParams.set('join', code);\n  return u.toString();\n};\nNet.copyInvite = async function (code) {\n  const text = 'Join my Atelier Air Hockey table: ' + Net.inviteUrl(code);\n  try {\n    await navigator.clipboard.writeText(text);\n    const b = $('copyInvite'); if (b) { b.textContent = 'Copied'; setTimeout(() => { if (b) b.textContent = 'Copy invite'; }, 1400); }\n  } catch (e) { Net.uiError('Could not copy automatically — copy the table code instead.'); }\n};\nNet.shareInvite = async function (code) {\n  if (!navigator.share) return Net.copyInvite(code);\n  try { await navigator.share({ title: 'Atelier Air Hockey', text: 'Join my table', url: Net.inviteUrl(code) }); }\n  catch (e) { if (e && e.name !== 'AbortError') Net.uiError('Could not open the share sheet.'); }\n};\n'''
html = replace_once(html, 'Net.uiError = function (msg) {', invite_helpers + '\nNet.uiError = function (msg) {', "invite helpers")
html = replace_once(
    html,
    '''Net.create = async function () {\n  Net.uiShow('waiting', { code: '' });\n  try {\n    const { joinRoom } = await Net.trystero();\n    const code = netGenCode();\n    const room = await Net.makeRoom(joinRoom, code);\n    Net.initRoom(room, 'host');''',
    '''Net.create = async function () {\n  const token = ++Net.opToken;\n  Net.uiShow('opening');\n  try {\n    const { joinRoom } = await Net.trystero();\n    if (token !== Net.opToken) return;\n    const code = netGenCode();\n    const room = await Net.makeRoom(joinRoom, code);\n    if (token !== Net.opToken) { try { room.leave(); } catch (e) {} return; }\n    Net.initRoom(room, 'host');''',
    "host async cancellation",
)
html = replace_once(
    html,
    '''Net.join = async function (rawCode) {\n  const code = (rawCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);\n  if (code.length !== 4) { Net.uiError('That code needs 4 letters — check it and try again.'); return; }\n  Net.uiShow('knocking', { code });\n  try {\n    const { joinRoom } = await Net.trystero();\n    const room = await Net.makeRoom(joinRoom, code);\n    Net.initRoom(room, 'guest');''',
    '''Net.join = async function (rawCode) {\n  const token = ++Net.opToken;\n  const code = (rawCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);\n  if (code.length !== 6) { Net.uiError('That code needs 6 characters — check it and try again.'); return; }\n  Net.uiShow('knocking', { code });\n  try {\n    const { joinRoom } = await Net.trystero();\n    if (token !== Net.opToken) return;\n    const room = await Net.makeRoom(joinRoom, code);\n    if (token !== Net.opToken) { try { room.leave(); } catch (e) {} return; }\n    Net.initRoom(room, 'guest');''',
    "guest async cancellation",
)
html = replace_once(
    html,
    '''Net.cancelLobby = function () {\n  clearTimeout(Net.joinTimer);''',
    '''Net.cancelLobby = function () {\n  Net.opToken++;\n  clearTimeout(Net.joinTimer);''',
    "cancel invalidates pending work",
)
html = replace_once(
    html,
    '''    onSt: (a) => Net.onSnapshot(a),\n    onIn: (a) => Net.onInput(a),\n    onEv: (ev) => Net.onEvent(ev),''',
    '''    onSt: (a, id) => Net.onSnapshot(a, id),\n    onIn: (a, id) => Net.onInput(a, id),\n    onEv: (ev, id) => Net.onEvent(ev, id),''',
    "route peer ids to handlers",
)
html = replace_once(
    html,
    '''  Net.room = null; Net.wire = null; Net.role = null;\n  Net.active = false; Net.waitingForRival = false;''',
    '''  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null;\n  Net.active = false; Net.waitingForRival = false;''',
    "clear selected peer",
)
html = replace_once(
    html,
    '''Net.onPeerJoin = function () {\n  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();\n};\nNet.onPeerLeave = function () {\n  if (Net.active || Net.waitingForRival) Net.onRivalLeft();\n};''',
    '''Net.acceptPeer = function (id) {\n  if (!id) return false;\n  if (!Net.peerId) Net.peerId = id;\n  return id === Net.peerId;\n};\nNet.onPeerJoin = function (id) {\n  if (!Net.acceptPeer(id)) return;\n  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();\n  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });\n};\nNet.onPeerLeave = function (id) {\n  if (id !== Net.peerId) return;\n  Net.peerId = null;\n  if (Net.active || Net.waitingForRival) Net.onRivalLeft();\n};''',
    "bind one rival",
)
html = replace_once(
    html,
    '''Net.onSnapshot = function (a) {\n  if (Net.role !== 'guest' || !Net.active) return;\n  const s = Net.decodeSnapshot(a);''',
    '''Net.onSnapshot = function (a, peerId) {\n  if (Net.role !== 'guest' || !Net.active || !Net.acceptPeer(peerId)) return;\n  if (!Array.isArray(a) || a.length < 15 || !a.slice(0, 15).every(Number.isFinite)) return;\n  const s = Net.decodeSnapshot(a);''',
    "snapshot validation",
)
html = replace_once(
    html,
    '''Net.onInput = function (a) {\n  if (Net.role !== 'host' || !Net.active) return;\n  Net.remote.tx = a[0]; Net.remote.ty = a[1];\n};\n\nNet.onEvent = function (ev) {\n  if (!ev || !ev.t) return;''',
    '''Net.onInput = function (a, peerId) {\n  if (Net.role !== 'host' || !Net.active || !Net.acceptPeer(peerId)) return;\n  if (!Array.isArray(a) || a.length < 2 || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) return;\n  Net.remote.tx = clamp(a[0], CX + MALLET_R, PX + PW - MALLET_R);\n  Net.remote.ty = clamp(a[1], PY + MALLET_R, PY + PH - MALLET_R);\n};\n\nNet.onEvent = function (ev, peerId) {\n  if (!Net.acceptPeer(peerId) || !ev || typeof ev !== 'object' || typeof ev.t !== 'string') return;''',
    "input and event validation",
)
html = replace_once(
    html,
    '''  Net.savedSettings = { firstTo: Settings.firstTo, pace: Settings.pace };\n  if (ev.firstTo) Settings.firstTo = ev.firstTo;''',
    '''  Net.savedSettings = { firstTo: Settings.firstTo, pace: Settings.pace, theme: THEME.id };\n  if ([5, 7, 11].includes(+ev.firstTo)) Settings.firstTo = +ev.firstTo;''',
    "validate hello and preserve theme",
)
html = replace_once(
    html,
    '  G.gwNet = (ev && ev.gw > 0) ? ev.gw : 0;',
    '  G.gwNet = (ev && Number.isFinite(ev.gw)) ? clamp(ev.gw, 150, 260) : 0;',
    "validate online goal width",
)
html = replace_once(
    html,
    '''  if (ev && typeof ev.svx === 'number' && typeof ev.svy === 'number') {\n    G.serveVX = ev.svx; G.serveVY = ev.svy; // host's rolled serve''',
    '''  if (ev && Number.isFinite(ev.svx) && Number.isFinite(ev.svy)) {\n    G.serveVX = clamp(ev.svx, -PUCK_MAX, PUCK_MAX); G.serveVY = clamp(ev.svy, -PUCK_MAX, PUCK_MAX); // host's rolled serve''',
    "validate online serve vector",
)
html = replace_once(
    html,
    '''Net.applyRemotePause = function (paused) {\n  if (paused) togglePause(true, true);\n  else togglePause(false, true);\n};''',
    '''Net.applyRemotePause = function (paused) {\n  if (paused && G.state !== 'pause') togglePause(true, true);\n  else if (!paused && G.state === 'pause') togglePause(false, true);\n};''',
    "idempotent remote pause",
)
html = html.replace('  Net.botM1 = null;\n', '', 1)
html = replace_once(
    html,
    '''    Settings.firstTo = Net.savedSettings.firstTo;\n    Settings.pace = Net.savedSettings.pace;\n    Net.savedSettings = null;''',
    '''    Settings.firstTo = Net.savedSettings.firstTo;\n    Settings.pace = Net.savedSettings.pace;\n    if (Net.savedSettings.theme && THEMES[Net.savedSettings.theme]) setTheme(Net.savedSettings.theme, true);\n    Net.savedSettings = null;''',
    "restore guest theme",
)

# Remove the in-page stub room + headless test harness from the production app.
html = sub_once(
    html,
    r'/\* ============================================================================\n \* STUB ROOM.*?(?=/\* ============================================================\n   ATELIER AIR HOCKEY — engine v2)',
    '',
    "remove production test harness",
    re.S,
)
html = re.sub(r'\n \* Test hook: `\?netstub`.*?\n \* ==========================================================================\*/', '\n * ==========================================================================*/', html, count=1, flags=re.S)
html = html.replace("    // ONLINE: ?netstub forces the loopback room for headless testing — no\n    // network is touched, Trystero is never imported.\n    if (q.has('netstub')) Net.useLoopback = true;\n", '', 1)

# ---------------------------------------------------------------------------
# UI safety / keyboard behavior / tour boot / performance
# ---------------------------------------------------------------------------
html = replace_once(
    html,
    "  $('btnMenu2').addEventListener('click', quitToMenu);",
    "  $('btnMenu2').addEventListener('click', () => {\n    if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);\n    else if (G.state === 'pause') { hideAll(); $('pauseov').classList.remove('hidden'); }\n    else quitToMenu();\n  });",
    "safe topbar menu",
)
html = replace_once(
    html,
    "  window.addEventListener('keydown', e => {\n    if (e.key === 'p' || e.key === 'P') togglePause();",
    "  window.addEventListener('keydown', e => {\n    const interactive = e.target && e.target.closest && e.target.closest('input, textarea, select, button, a, [contenteditable=\"true\"]');\n    if (interactive && e.key !== 'Escape') return;\n    if (e.key === 'p' || e.key === 'P') togglePause();",
    "guard global shortcuts",
)
html = replace_once(
    html,
    '''  let rzT = 0;\n  const onResize = () => {\n    clearTimeout(rzT);\n    rzT = setTimeout(resize, 60);\n    resize();\n  };''',
    '''  let rzRAF = 0, rzT = 0;\n  const onResize = () => {\n    if (!rzRAF) rzRAF = requestAnimationFrame(() => { rzRAF = 0; resize(); });\n    clearTimeout(rzT);\n    rzT = setTimeout(resize, 120);\n  };''',
    "throttle resize",
)
html = html.replace("  document.addEventListener('gesturestart', e => e.preventDefault());\n", '', 1)
html = replace_once(
    html,
    '''  resize(); wireUI(); applySettingsToUI();\n  setTheme('deco', true);\n  try { paintThumbnails(); } catch (e) { /* thumbnails must never break the game */ }''',
    '''  resize(); wireUI(); applySettingsToUI();\n  let initialTheme = 'deco';\n  try { const savedTheme = localStorage.getItem('atelier-ah-theme'); if (savedTheme && THEMES[savedTheme]) initialTheme = savedTheme; } catch (e) {}\n  setTheme(initialTheme, true);\n  refreshTour();\n  const paintLater = () => { try { paintThumbnails(); } catch (e) { console.warn('Thumbnail paint failed', e); } };\n  if ('requestIdleCallback' in window) requestIdleCallback(paintLater, { timeout: 800 }); else setTimeout(paintLater, 0);''',
    "boot ordering and lazy thumbnails",
)
html = replace_once(
    html,
    '''    if (q.has('play')) startGame('ai', G.difficulty);\n    else if (q.has('2p')) startGame('2p');\n    else if (q.has('demo')) { G.idleT = 99; }''',
    '''    if (q.get('join')) { Net.openLobby(); Net.join(q.get('join')); }\n    else if (q.has('play')) startGame('ai', G.difficulty);\n    else if (q.has('2p')) startGame('2p');\n    else if (q.has('demo')) { G.idleT = 99; }''',
    "invite deep link",
)

# ---------------------------------------------------------------------------
# Progress cabinet, result sharing, visibility pause, keyboard/gamepad control
# ---------------------------------------------------------------------------
progress_js = r'''
function renderProgress() {
  const body = $('progressBody'), summary = $('progressSummary');
  if (!body || !summary) return;
  const unlocked = FEATS.filter(f => Feats.data[f.id]).length;
  summary.textContent = Tour.count() + '/' + THEME_ORDER.length + ' tables conquered · ' + unlocked + '/' + FEATS.length + ' feats unlocked';
  const featRows = FEATS.map(f => '<div class="progress-item"><span>' + (Feats.data[f.id] ? '★ ' : '○ ') + f.name + '</span><span>' + f.desc + '</span></div>').join('');
  const tableRows = THEME_ORDER.map(id => '<div class="progress-item"><span>' + (Tour.won(id) ? '★ ' : '○ ') + THEMES[id].name + '</span><span>' + (Tour.data[id] || 0) + ' wins</span></div>').join('');
  body.innerHTML = '<div class="seclabel">ACHIEVEMENTS</div>' + featRows + '<div class="seclabel">TABLE TOUR</div>' + tableRows;
}
function shareResult() {
  const score = G.score[0] + '–' + G.score[1];
  const text = 'Atelier Air Hockey · ' + THEME.name + ' · ' + score;
  const url = location.origin + location.pathname + '?table=' + encodeURIComponent(G.themeId);
  if (navigator.share) navigator.share({ title: 'Atelier Air Hockey', text, url }).catch(e => { if (e && e.name !== 'AbortError') console.warn(e); });
  else if (navigator.clipboard) navigator.clipboard.writeText(text + ' · ' + url).then(() => { const b = $('btnShareResult'); if (b) { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Share result', 1400); } }).catch(e => console.warn(e));
}

const keyDrive = new Set();
let keyLast = performance.now();
function keyboardGamepadDrive(now) {
  const dt = Math.min(0.04, Math.max(0, (now - keyLast) / 1000)); keyLast = now;
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const speed = 920;
    const move = (m, left, right, up, down, lo, hi) => {
      let dx = (keyDrive.has(right) ? 1 : 0) - (keyDrive.has(left) ? 1 : 0);
      let dy = (keyDrive.has(down) ? 1 : 0) - (keyDrive.has(up) ? 1 : 0);
      if (dx || dy) {
        const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
        m.tx = clamp(m.tx + dx * speed * dt, lo, hi);
        m.ty = clamp(m.ty + dy * speed * dt, PY + MALLET_R, PY + PH - MALLET_R);
      }
    };
    move(G.m1, 'KeyA', 'KeyD', 'KeyW', 'KeyS', PX + MALLET_R, CX - MALLET_R);
    if (G.mode === '2p') move(G.m2, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', CX + MALLET_R, PX + PW - MALLET_R);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const applyPad = (pad, m, lo, hi) => {
        if (!pad) return;
        const ax = Math.abs(pad.axes[0] || 0) > .18 ? pad.axes[0] : 0;
        const ay = Math.abs(pad.axes[1] || 0) > .18 ? pad.axes[1] : 0;
        if (ax || ay) { m.tx = clamp(m.tx + ax * speed * dt, lo, hi); m.ty = clamp(m.ty + ay * speed * dt, PY + MALLET_R, PY + PH - MALLET_R); }
      };
      applyPad(pads[0], G.m1, PX + MALLET_R, CX - MALLET_R);
      if (G.mode === '2p') applyPad(pads[1] || pads[0], G.m2, CX + MALLET_R, PX + PW - MALLET_R);
    } catch (e) {}
  }
  requestAnimationFrame(keyboardGamepadDrive);
}
'''
html = replace_once(html, '// ---------- UI wiring ----------', progress_js + '\n// ---------- UI wiring ----------', "progress and desktop controls")

html = replace_once(
    html,
    '''  $('btnHelp').addEventListener('click', () => { AudioSys.ui(); applySettingsToUI(); hideAll(); $('help').classList.remove('hidden'); });''',
    '''  $('btnHelp').addEventListener('click', () => { AudioSys.ui(); applySettingsToUI(); hideAll(); $('help').classList.remove('hidden'); });\n  $('btnProgress').addEventListener('click', () => { AudioSys.ui(); renderProgress(); hideAll(); $('progress').classList.remove('hidden'); });\n  $('progressClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });\n  $('btnResetProgress').addEventListener('click', () => {\n    if (!confirm('Reset records, personal bests, achievements, and table-tour progress on this device?')) return;\n    [Record.key, Best.key, Feats.key, Tour.key].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });\n    Record.load(); Best.load(); Feats.load(); Tour.load(); refreshRecordLines(); refreshTour(); renderProgress();\n  });''',
    "wire progression cabinet",
)
html = replace_once(
    html,
    "  $('btnWinMenu').addEventListener('click', quitToMenu);",
    "  $('btnWinMenu').addEventListener('click', quitToMenu);\n  $('btnShareResult').addEventListener('click', shareResult);",
    "wire result sharing",
)
html = replace_once(
    html,
    '''  canvas.addEventListener('pointerdown', onPointerDown);''',
    '''  window.addEventListener('keydown', e => {\n    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code) && (G.state === 'play' || G.state === 'count')) { keyDrive.add(e.code); e.preventDefault(); }\n  }, { passive: false });\n  window.addEventListener('keyup', e => keyDrive.delete(e.code));\n  document.addEventListener('visibilitychange', () => {\n    if (document.hidden && (G.state === 'play' || G.state === 'count' || G.state === 'goal')) togglePause(true);\n  });\n  canvas.addEventListener('pointerdown', onPointerDown);''',
    "keyboard and visibility listeners",
)
html = replace_once(
    html,
    "  requestAnimationFrame(frame);\n}",
    "  requestAnimationFrame(frame);\n  requestAnimationFrame(keyboardGamepadDrive);\n  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker registration failed', e));\n}",
    "start platform integrations",
)

# Dialog semantics and online live error region can be set statically without a
# fragile focus-manager rewrite. Focus-visible styling + native controls retain
# browser focus behavior.
html = html.replace('<div class="overlay hidden" id="help">', '<div class="overlay hidden" id="help" role="dialog" aria-modal="true" aria-labelledby="helpTitle">', 1)
html = html.replace('<h1>How to play</h1>', '<h1 id="helpTitle">How to play</h1>', 1)
html = html.replace('<div class="overlay hidden" id="settings">', '<div class="overlay hidden" id="settings" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">', 1)
html = html.replace('<div class="overlay hidden" id="pauseov">', '<div class="overlay hidden" id="pauseov" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">', 1)
html = html.replace('<div class="overlay hidden" id="winov">', '<div class="overlay hidden" id="winov" role="dialog" aria-modal="true" aria-labelledby="winTitle">', 1)
html = html.replace('id="onlineErr"', 'id="onlineErr" role="status" aria-live="polite"', 1)

# ---------------------------------------------------------------------------
# Extract the v23 monolith into maintained source files.
# ---------------------------------------------------------------------------
style = re.search(r'<style>\n(.*?)\n</style>', html, re.S)
if not style:
    raise RuntimeError('could not locate inline style block')
scripts = list(re.finditer(r'<script>\n(.*?)\n</script>', html, re.S))
if len(scripts) != 3:
    raise RuntimeError(f'expected 3 inline script blocks, found {len(scripts)}')

styles_css = style.group(1)
themes_js = scripts[0].group(1)
scoreboards_js = scripts[1].group(1)
app_js = scripts[2].group(1)

# Keep the current protocol comment honest after the snapshot gained saves.
app_js = app_js.replace(
    '[px,py,pvx,pvy, m1x,m1y, m2x,m2y, s0,s1, flags, top, br]',
    '[px,py,pvx,pvy, m1x,m1y, m2x,m2y, s0,s1, flags, top, br, sv0, sv1]'
)
app_js = app_js.replace('        12   host bestRally (int, for the guest\'s win card)', '        12   host bestRally (int, for the guest\'s win card)\n *        13-14 host saves [side0, side1]')

# Replace blocks back-to-front so offsets remain valid.
for match, tag in reversed([
    (scripts[0], '<script src="./src/themes.js"></script>'),
    (scripts[1], '<script src="./src/scoreboards.js"></script>'),
    (scripts[2], '<script src="./src/app.js"></script>'),
]):
    html = html[:match.start()] + tag + html[match.end():]
# style offsets were before scripts and remain valid only after recomputing.
style2 = re.search(r'<style>\n(.*?)\n</style>', html, re.S)
if not style2:
    raise RuntimeError('style block disappeared during extraction')
html = html[:style2.start()] + '<link rel="stylesheet" href="./src/styles.css">' + html[style2.end():]

SRC.mkdir(parents=True, exist_ok=True)
write(SRC / 'styles.css', styles_css)
write(SRC / 'themes.js', themes_js)
write(SRC / 'scoreboards.js', scoreboards_js)
write(SRC / 'app.js', app_js)
write(SRC / 'template.html', html)
write(INDEX, html)

# Remove stale v7-era pseudo-sources/builders. Git history remains the archive.
for stale in ['build2.js', 'build3.js', 'engine2.js', 'net.js', 'template2.html', 'themes2.js']:
    p = SRC / stale
    if p.exists():
        p.unlink()

# ---------------------------------------------------------------------------
# Reproducible build/check scripts, manifest, service worker, CI.
# ---------------------------------------------------------------------------
write(ROOT / 'scripts' / 'build.mjs', r'''import { readFile, writeFile } from 'node:fs/promises';
const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
await writeFile(new URL('../index.html', import.meta.url), template);
console.log('Built index.html from src/template.html');''')

write(ROOT / 'scripts' / 'check.mjs', r'''import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [index, template, app, boards, themes, css] = await Promise.all([
  readFile('index.html','utf8'), readFile('src/template.html','utf8'), readFile('src/app.js','utf8'),
  readFile('src/scoreboards.js','utf8'), readFile('src/themes.js','utf8'), readFile('src/styles.css','utf8')
]);
assert.equal(index, template, 'index.html must be generated from src/template.html');
assert.match(index, /src\/styles\.css/); assert.match(index, /src\/app\.js/);
assert.doesNotMatch(index, /<style>/); assert.doesNotMatch(index, /<script>\s/);
assert.match(app, /opToken/); assert.match(app, /peerId/); assert.match(app, /bestStreak: \[0, 0\]/);
assert.match(boards, /Math\.max\(11, target \+ 1\)/);
assert.match(themes, /THEMES\.deco/); assert.match(css, /focus-visible/);
assert.doesNotMatch(app, /createStubPair/); assert.doesNotMatch(app, /netstub/);
console.log('Static stabilization checks passed');''')

package = {
    'name': 'atelier-air-hockey',
    'version': '1.0.0',
    'private': True,
    'type': 'module',
    'scripts': {
        'build': 'node scripts/build.mjs',
        'check': 'node scripts/check.mjs',
        'test': 'npm run build && npm run check',
    },
}
write(ROOT / 'package.json', json.dumps(package, indent=2))

manifest = {
    'name': 'Atelier Air Hockey',
    'short_name': 'Air Hockey',
    'description': 'A handcrafted browser air-hockey game with nine art-directed tables.',
    'start_url': './',
    'scope': './',
    'display': 'standalone',
    'orientation': 'any',
    'background_color': '#070606',
    'theme_color': '#070606',
    'icons': [
        {'src': './assets/icon.svg', 'sizes': 'any', 'type': 'image/svg+xml', 'purpose': 'any maskable'},
    ],
}
write(ROOT / 'manifest.webmanifest', json.dumps(manifest, indent=2))

icon_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#070606"/><rect x="72" y="132" width="368" height="248" rx="38" fill="#1b1510" stroke="#c9a227" stroke-width="14"/><path d="M256 148v216" stroke="#8a6d2f" stroke-width="7" stroke-dasharray="18 16"/><circle cx="256" cy="256" r="34" fill="#e9d9a6"/><circle cx="158" cy="256" r="48" fill="#c9a227"/><circle cx="354" cy="256" r="48" fill="#c9a227"/><circle cx="158" cy="256" r="20" fill="#14100a"/><circle cx="354" cy="256" r="20" fill="#14100a"/></svg>'''
write(ASSETS / 'icon.svg', icon_svg)

# The HTML points at icon-192.png for broad browser compatibility. Keep that
# link valid with a tiny standards-compliant SVG fallback redirect via copy is
# not possible, so point HTML to the SVG instead.
index_text = INDEX.read_text(encoding='utf-8').replace('./assets/icon-192.png', './assets/icon.svg')
write(INDEX, index_text)
write(SRC / 'template.html', index_text)

write(ROOT / 'sw.js', r'''const CACHE='atelier-air-hockey-v1';
const CORE=['./','./index.html','./manifest.webmanifest','./assets/icon.svg','./src/styles.css','./src/themes.js','./src/scoreboards.js','./src/app.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return res;}).catch(()=>caches.match('./index.html'))));
});''')

write(ROOT / '.github' / 'workflows' / 'ci.yml', r'''name: CI
on:
  push:
    branches: [main, stabilization-v24]
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm test
''')

# README: replace stale claims with a concise truthful current description.
readme = '''# Atelier Air Hockey\n\nA handcrafted browser air-hockey game with nine art-directed tables, local AI rivals, same-screen two-player play, and peer-to-peer online matches.\n\n**Play:** https://builtbysai.com/atelier-air-hockey/\n\n## Development\n\n`src/` is the source of truth. `src/template.html` is the page shell, with `styles.css`, `themes.js`, `scoreboards.js`, and `app.js` loaded as classic browser sources in dependency order. The root `index.html` is generated from `src/template.html` for GitHub Pages.\n\n```bash\nnpm run build\nnpm test\n```\n\nCI fails when the generated root file drifts from the source template or when core stabilization invariants regress. Historical v4-v7 HTML snapshots remain in Git history; current releases should use Git tags/releases rather than duplicated production files.\n\n## Controls\n\n- Mouse/touch: direct mallet control.\n- Keyboard: WASD for player one; arrow keys for player two.\n- Gamepads: first pad controls player one; a second pad controls player two when available.\n- P: pause/resume. M: mute/unmute. Esc: pause/resume.\n\n## Online play\n\nOnline matches use Trystero/WebRTC with Nostr signaling. The host is authoritative for physics and match settings. Rooms use a six-character invite code/deep link, accept one bound rival, validate inbound input, and ignore messages from extra peers. No account is required.\n\n## Local data\n\nSettings, records, personal bests, achievements, and table-tour progress are stored only in this browser via `localStorage`. They can be reset from the Progress screen.\n\n## License\n\nSee [LICENSE](./LICENSE).\n'''
write(ROOT / 'README.md', readme)

print('v24 stabilization migration completed')

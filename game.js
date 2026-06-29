// Client-State + Render der Spiel-Screens.
// WICHTIG: Hier liegt KEINE Spiel-Autoritaet – Regeln werden serverseitig
// geprueft. Tisch/Hand/Stich liegen in table.js (eigene Komponenten).
import { renderTable } from './table.js?v=42';
import { $, esc, clearChildren, toast, confetti } from './ui.js?v=2';
import { sfxWin, haptic } from './audio.js?v=4';
import { gameOverAd } from './ads.js?v=3';

// Spielende-Feier nur einmal pro beendetem Spiel ausloesen.
let celebrated = false;

// Einladungs-Link bauen + teilen (WhatsApp & Co. via Web-Share, sonst Kopie).
function inviteUrl(code) {
  return `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}`;
}
async function shareInvite(code) {
  const url = inviteUrl(code);
  const text = `Spiel mit mir Zaubertisch! Tritt meinem Spiel bei (Code ${code}): ${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Zaubertisch', text: `Spiel mit mir Zaubertisch! Code ${code}`, url }); return; }
    catch (_) { return; }   // Nutzer hat den Teilen-Dialog abgebrochen
  }
  try { await navigator.clipboard.writeText(url); toast('Einladungs-Link kopiert – z. B. in WhatsApp einfügen', 'ok'); }
  catch (_) {
    try { await navigator.clipboard.writeText(text); toast('Einladung kopiert', 'ok'); }
    catch (__) { toast('Link: ' + url, 'info'); }
  }
}

export function render(state, actions) {
  const { game } = state;
  const root = $('#game-view');
  clearChildren(root);

  if (game.status === 'lobby') { celebrated = false; renderWaitingRoom(root, state, actions); return; }

  renderTable(root, state, actions);            // laufend / beendet: Spieltisch
  renderScoreboard(root, state, game.status === 'finished' || game.status === 'aborted');

  // Spielende: einmalig Konfetti + Fanfare, danach (nur App) Vollbild-Werbung.
  if (game.status === 'finished') {
    if (!celebrated) {
      celebrated = true; confetti(); sfxWin(); haptic([40, 60, 40, 60, 140]);
      setTimeout(() => gameOverAd(), 3200);   // nach der Feier
    }
  } else {
    celebrated = false;
  }
}

// --- Warteraum / Lobby -----------------------------------------------------
function renderWaitingRoom(root, state, actions) {
  const { game, players, uid } = state;
  const isHost = game.host_uid === uid;

  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = `
    <h2>Warteraum</h2>
    <p class="muted">Teile den Code mit deinen Freunden:</p>
    <div class="code-big">${esc(game.join_code)}</div>
    <p class="muted">${players.length} Spieler:innen (3–6 zum Starten)</p>
    <ul class="roster">${players.map(p => `
      <li>${esc(p.name)}${p.is_host ? ' 👑' : ''}${p.uid === uid ? ' <span class="you">(du)</span>' : ''}</li>
    `).join('')}</ul>
  `;
  // Einladungs-Link teilen (direkt unter dem Code).
  const shareRow = document.createElement('div');
  shareRow.className = 'row';
  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn';
  shareBtn.type = 'button';
  shareBtn.innerHTML = '🔗 Einladungs-Link teilen';
  shareBtn.onclick = () => shareInvite(game.join_code);
  shareRow.appendChild(shareBtn);
  const codeEl = box.querySelector('.code-big');
  if (codeEl) codeEl.insertAdjacentElement('afterend', shareRow);
  else box.appendChild(shareRow);

  const btns = document.createElement('div');
  btns.className = 'row';
  if (isHost) {
    const start = document.createElement('button');
    start.className = 'btn';
    start.textContent = 'Spiel starten';
    start.disabled = players.length < 3 || players.length > 6;
    start.onclick = () => actions.onStart();
    btns.appendChild(start);
  } else {
    const wait = document.createElement('p');
    wait.className = 'muted';
    wait.textContent = 'Warte auf den Host …';
    btns.appendChild(wait);
  }
  const leave = document.createElement('button');
  leave.className = 'btn sekundaer';
  leave.textContent = 'Verlassen';
  leave.onclick = () => actions.onLeave();
  btns.appendChild(leave);
  box.appendChild(btns);
  root.appendChild(box);

  renderInviteFriends(root, state, actions);
}

// Freunde direkt in diesen Warteraum einladen.
function renderInviteFriends(root, state, actions) {
  if (!actions.onLoadFriends) return;
  const { players } = state;
  const box = document.createElement('div');
  box.className = 'panel';
  box.innerHTML = '<h3>Freunde einladen</h3><div class="stack" id="invite-list"><p class="muted">Lädt …</p></div>';
  root.appendChild(box);

  const here = new Set(players.map(p => p.uid));
  actions.onLoadFriends().then(list => {
    const cont = box.querySelector('#invite-list');
    const avail = (list || []).filter(f => !here.has(f.uid));
    if (!avail.length) {
      cont.innerHTML = `<p class="muted">${list && list.length ? 'Alle Freunde sind schon dabei.' : 'Noch keine Freunde – im Profil hinzufügen.'}</p>`;
      return;
    }
    cont.innerHTML = '';
    avail.forEach(f => {
      const av = f.avatar || 'avatars/av01.png';
      const avHtml = (/^https?:\/\//.test(av) || /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(av)) ? `<img class="av-img" src="${esc(av)}" alt="">` : esc(av);
      const row = document.createElement('div');
      row.className = 'friend';
      row.innerHTML = `<div class="friend-av">${avHtml}</div>
        <div class="friend-main"><div class="friend-name">${esc(f.name)}</div></div>`;
      const b = document.createElement('button');
      b.className = 'friend-invite';
      b.type = 'button';
      b.textContent = 'Einladen';
      b.onclick = () => { b.disabled = true; b.textContent = 'Eingeladen ✓'; actions.onInvite(f.uid); };
      row.appendChild(b);
      cont.appendChild(row);
    });
  }).catch(() => {
    box.querySelector('#invite-list').innerHTML = '<p class="muted">Freunde konnten nicht geladen werden.</p>';
  });
}

// --- Wertungstabelle -------------------------------------------------------
function renderScoreboard(root, state, isFinal) {
  const { players, scores } = state;
  const box = document.createElement('div');
  box.className = 'panel';
  const ordered = [...players].sort((a, b) => a.seat - b.seat);

  if (isFinal) {
    const winner = [...players].sort((a, b) => b.total_score - a.total_score)[0];
    box.innerHTML = `<h2>🏆 ${esc(winner?.name ?? '')} gewinnt mit ${winner?.total_score} Punkten!</h2>`;
  } else {
    box.innerHTML = '<h3>Punktestand</h3>';
  }

  const rounds = [...new Set(scores.map(s => s.round_no))].sort((a, b) => a - b);
  let html = '<table class="scoreboard"><thead><tr><th>Runde</th>';
  ordered.forEach(p => { html += `<th>${esc(p.name)}</th>`; });
  html += '</tr></thead><tbody>';
  rounds.forEach(rn => {
    html += `<tr><td>${rn}</td>`;
    ordered.forEach(p => {
      const s = scores.find(x => x.round_no === rn && x.seat === p.seat);
      const cls = s && s.round_score > 0 ? 'pos' : (s && s.round_score < 0 ? 'neg' : '');
      html += `<td class="${cls}">${s ? (s.round_score > 0 ? '+' : '') + s.round_score : ''}</td>`;
    });
    html += '</tr>';
  });
  html += '<tr class="total-row"><td>Σ</td>';
  ordered.forEach(p => { html += `<td>${p.total_score}</td>`; });
  html += '</tr></tbody></table>';
  box.insertAdjacentHTML('beforeend', html);
  root.appendChild(box);
}

// Main app controller

const socket = io();
const gameUI = new GameUI(socket);

// DOM elements
const screens = {
  landing: document.getElementById('landing'),
  lobby: document.getElementById('lobby'),
  game: document.getElementById('game'),
  gameOver: document.getElementById('gameOver')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// Global toast for errors/info - works on any screen
function showToast(msg, isError = false) {
  const toast = document.createElement('div');
  toast.classList.add('toast');
  if (isError) toast.style.borderColor = '#e94560';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Landing page
const btnCreate = document.getElementById('btnCreate');
const btnJoinShow = document.getElementById('btnJoinShow');
const btnJoin = document.getElementById('btnJoin');
const joinForm = document.getElementById('joinForm');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const errorMsg = document.getElementById('errorMsg');

// Lobby
const lobbyCode = document.getElementById('lobbyCode');
const playerList = document.getElementById('playerList');
const hostControls = document.getElementById('hostControls');
const waitingMsg = document.getElementById('waitingMsg');
const btnAddAI = document.getElementById('btnAddAI');
const btnStartGame = document.getElementById('btnStartGame');
const btnCopyCode = document.getElementById('btnCopyCode');

function showError(msg) {
  // Show on landing error div
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  setTimeout(() => errorMsg.classList.add('hidden'), 3000);
  // Also show toast (works on any screen)
  showToast(msg, true);
}

function getName() {
  const name = playerNameInput.value.trim();
  if (!name) {
    showError('הזן שם!');
    playerNameInput.focus();
    playerNameInput.style.borderColor = '#e94560';
    setTimeout(() => playerNameInput.style.borderColor = '', 2000);
    return null;
  }
  return name;
}

// Create game
btnCreate.addEventListener('click', () => {
  const name = getName();
  if (!name) return;

  if (!socket.connected) {
    showError('אין חיבור לשרת! טוען מחדש...');
    setTimeout(() => location.reload(), 1500);
    return;
  }

  btnCreate.disabled = true;
  btnCreate.textContent = 'יוצר משחק...';

  socket.emit('create_room', { name }, (res) => {
    btnCreate.disabled = false;
    btnCreate.textContent = 'צור משחק';

    if (res.error) return showError(res.error);

    gameUI.roomCode = res.code;
    gameUI.isHost = true;
    lobbyCode.textContent = res.code;
    updatePlayerList(res.players);
    hostControls.classList.remove('hidden');
    waitingMsg.classList.add('hidden');
    showScreen('lobby');
  });
});

// Show join form
btnJoinShow.addEventListener('click', () => {
  joinForm.classList.toggle('hidden');
  if (!joinForm.classList.contains('hidden')) {
    roomCodeInput.focus();
  }
});

// Join game
btnJoin.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  const code = roomCodeInput.value.trim();
  if (code.length !== 4) return showError('קוד חדר חייב להיות 4 ספרות');

  socket.emit('join_room', { code, name }, (res) => {
    if (res.error) {
      if (res.error === 'room_not_found') return showError('חדר לא נמצא');
      if (res.error === 'room_full') return showError('החדר מלא');
      if (res.error === 'game_already_started') return showError('המשחק כבר התחיל');
      return showError(res.error);
    }

    gameUI.roomCode = code;
    gameUI.isHost = false;
    lobbyCode.textContent = code;
    updatePlayerList(res.players);
    hostControls.classList.add('hidden');
    waitingMsg.classList.remove('hidden');
    showScreen('lobby');
  });
});

// Enter key on room code input
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

playerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnCreate.click();
});

// Copy room code
btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(gameUI.roomCode).then(() => {
    btnCopyCode.textContent = 'הועתק!';
    setTimeout(() => btnCopyCode.textContent = 'העתק', 2000);
  });
});

// Add AI
let aiCount = 0;
btnAddAI.addEventListener('click', () => {
  aiCount++;
  const names = ['רובוט 🤖', 'בוטי 🤖', 'מכונה 🤖', 'סייבורג 🤖', 'אנדרואיד 🤖'];
  const name = names[(aiCount - 1) % names.length];

  btnAddAI.disabled = true;
  btnAddAI.textContent = 'מוסיף...';

  socket.emit('add_ai', { code: gameUI.roomCode, name }, (res) => {
    btnAddAI.disabled = false;
    btnAddAI.textContent = '➕ הוסף בוט';

    if (res.error) {
      showToast('שגיאה: ' + res.error, true);
      return;
    }
    updatePlayerList(res.players);
    showToast(name + ' הצטרף למשחק!');
  });
});

// Start game
btnStartGame.addEventListener('click', () => {
  btnStartGame.disabled = true;
  btnStartGame.textContent = 'מתחיל...';

  socket.emit('start_game', { code: gameUI.roomCode }, (res) => {
    btnStartGame.disabled = false;
    btnStartGame.textContent = 'התחל משחק';

    if (res.error) {
      showToast('שגיאה: ' + res.error, true);
      return;
    }
  });
});

function updatePlayerList(players) {
  playerList.innerHTML = '';
  for (const p of players) {
    const div = document.createElement('div');
    div.classList.add('player-item');
    div.innerHTML = `
      <span class="player-icon">${p.isAI ? '🤖' : '👤'}</span>
      <span>${p.name}</span>
      ${p.id === socket.id ? '<span class="host-badge" style="background:var(--green)">אני</span>' : ''}
    `;
    playerList.appendChild(div);
  }

  // Enable start button if enough players
  if (gameUI.isHost) {
    btnStartGame.disabled = players.length < 3;
  }
}

// --- Socket Events ---

socket.on('player_joined', ({ players }) => {
  updatePlayerList(players);
});

socket.on('player_left', ({ players }) => {
  updatePlayerList(players);
});

socket.on('game_started', (state) => {
  showScreen('game');
  gameUI.updateState(state);
  gameUI.logAction('המשחק התחיל! 🎮');
});

socket.on('state_update', (state) => {
  gameUI.updateState(state);
});

socket.on('someone_asked', ({ askerIdx, askerName, giverIdx, giverName, value }) => {
  gameUI.logAction(`${askerName} מבקש מ${giverName}: "תביא לי ${getValueName(value)}!"`, true);
});

socket.on('card_given', ({ giverIdx, giverName, askerIdx }) => {
  const askerName = gameUI.state?.players[askerIdx]?.name || '?';
  gameUI.logAction(`${giverName} נתן קלף הפוך ל${askerName} 🎴`);
});

socket.on('card_believed', ({ playerIdx, cardReceived, quartetsPlaced, gameOver }) => {
  const name = gameUI.state?.players[playerIdx]?.name || '?';
  gameUI.logAction(`${name} מאמין! ✅`);

  if (quartetsPlaced && quartetsPlaced.length > 0) {
    for (const q of quartetsPlaced) {
      gameUI.logAction(`🎉 ${name} השלים רביעייה של ${getValueName(q.value)}!`, true);
    }
  }
});

socket.on('player_doubted', ({ playerIdx }) => {
  const name = gameUI.state?.players[playerIdx]?.name || '?';
  gameUI.logAction(`${name} לא מאמין! ❌ מבקש קלף נוסף`);
});

socket.on('second_card_given', () => {
  gameUI.logAction('קלף שני ניתן — בחר אחד!');
});

socket.on('card_picked', ({ playerIdx, quartetsPlaced, gameOver }) => {
  const name = gameUI.state?.players[playerIdx]?.name || '?';
  gameUI.logAction(`${name} בחר קלף`);

  if (quartetsPlaced && quartetsPlaced.length > 0) {
    for (const q of quartetsPlaced) {
      gameUI.logAction(`🎉 ${name} השלים רביעייה של ${getValueName(q.value)}!`, true);
    }
  }
});

socket.on('player_doubted_again', ({ playerIdx }) => {
  const name = gameUI.state?.players[playerIdx]?.name || '?';
  gameUI.logAction(`${name} עדיין חושד! מבקש קלף שלישי 😤`);
});

socket.on('third_card_taken', ({ playerIdx, cardReceived, quartetsPlaced }) => {
  const name = gameUI.state?.players[playerIdx]?.name || '?';
  gameUI.logAction(`${name} לקח את הקלף השלישי (בלית ברירה!)`);

  if (quartetsPlaced && quartetsPlaced.length > 0) {
    for (const q of quartetsPlaced) {
      gameUI.logAction(`🎉 ${name} השלים רביעייה של ${getValueName(q.value)}!`, true);
    }
  }
});

// (no_volunteer removed — in new flow, giver always gives)

socket.on('game_over', (data) => {
  gameUI.showGameOver(data);
  showScreen('gameOver');
});

// Back to lobby
document.getElementById('btnBackToLobby').addEventListener('click', () => {
  showScreen('landing');
  gameUI.roomCode = null;
  gameUI.isHost = false;
  gameUI.state = null;
  aiCount = 0;
});

// Connection status
socket.on('disconnect', () => {
  document.body.classList.add('disconnected');
  showToast('התנתקת מהשרת...', true);
});

socket.on('connect', () => {
  document.body.classList.remove('disconnected');
  console.log('Socket connected:', socket.id);
  if (gameUI.roomCode) {
    showToast('התחברת מחדש!');
  }
});

socket.on('connect_error', (err) => {
  console.error('Socket connection error:', err);
  showToast('שגיאת חיבור לשרת', true);
});

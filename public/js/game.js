// Game UI controller

class GameUI {
  constructor(socket) {
    this.socket = socket;
    this.roomCode = null;
    this.myIndex = -1;
    this.state = null;
    this.selectedCard = null;
    this.isHost = false;

    this.els = {
      otherPlayers: document.getElementById('otherPlayers'),
      tableCenter: document.getElementById('tableCenter'),
      quartetsArea: document.getElementById('quartetsArea'),
      actionLog: document.getElementById('actionLog'),
      actionPanel: document.getElementById('actionPanel'),
      myHand: document.getElementById('myHand'),
      turnIndicator: document.getElementById('turnIndicator')
    };
  }

  updateState(state) {
    this.state = state;
    this.myIndex = state.myIndex;
    this.renderOtherPlayers();
    this.renderMyHand();
    this.renderQuartets();
    this.renderTurnIndicator();
    this.renderActionPanel();
  }

  renderOtherPlayers() {
    const { players, currentTurn } = this.state;
    this.els.otherPlayers.innerHTML = '';

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const div = document.createElement('div');
      div.classList.add('other-player');
      if (i === currentTurn) div.classList.add('active-turn');
      if (i === this.myIndex) div.classList.add('is-me');

      const miniCards = Array(Math.min(p.cardCount, 10))
        .fill('<div class="mini-card-back"></div>')
        .join('');

      div.innerHTML = `
        <span class="player-name">${p.name}${i === this.myIndex ? ' (אני)' : ''}${p.isAI ? ' 🤖' : ''}</span>
        <span class="card-count">${p.cardCount} 🃏</span>
        <div class="mini-cards">${miniCards}</div>
      `;

      this.els.otherPlayers.appendChild(div);
    }
  }

  renderMyHand() {
    const hand = this.state.hand;
    this.els.myHand.innerHTML = '';

    const sorted = [...hand].sort((a, b) => {
      if (a.value === 'JOKER') return 1;
      if (b.value === 'JOKER') return -1;
      const vals = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      const vi = vals.indexOf(a.value) - vals.indexOf(b.value);
      if (vi !== 0) return vi;
      return a.suit.localeCompare(b.suit);
    });

    for (const card of sorted) {
      const el = createCardElement(card, true);

      el.addEventListener('click', () => {
        if (this.selectedCard === card.id) {
          this.selectedCard = null;
          el.classList.remove('selected');
        } else {
          this.els.myHand.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
          this.selectedCard = card.id;
          el.classList.add('selected');
        }
      });

      this.els.myHand.appendChild(el);
    }
  }

  renderQuartets() {
    this.els.quartetsArea.innerHTML = '';
    for (const q of this.state.quartets) {
      const div = document.createElement('div');
      div.classList.add('quartet-stack');
      div.innerHTML = `${this.state.players[q.playerIdx].name}: 4×${getValueName(q.value)}`;
      this.els.quartetsArea.appendChild(div);
    }
  }

  renderTurnIndicator() {
    // The giver (currentTurn) has 5 cards. Highlight if I'm the giver OR if I can ask.
    const isGiver = this.state.currentTurn === this.myIndex;
    const canAsk = !isGiver && this.state.phase === 'asking';
    this.els.turnIndicator.className = 'turn-indicator' + ((isGiver || canAsk) ? ' my-turn' : '');
  }

  renderActionPanel() {
    const panel = this.els.actionPanel;
    const { phase, currentTurn, askedValue, askerIdx } = this.state;
    const isGiver = currentTurn === this.myIndex;
    const isAsker = askerIdx === this.myIndex;
    const giverName = this.state.players[currentTurn]?.name || '?';

    panel.classList.remove('hidden');
    panel.innerHTML = '';

    switch (phase) {
      case 'asking':
        if (isGiver) {
          // I'm the giver (5 cards) — waiting for someone to ask me
          panel.innerHTML = `<span class="action-title">יש לך 5 קלפים — ממתין שמישהו יבקש ממך קלף...</span>`;
        } else {
          // I can ask the giver for a card
          this.renderAskPanel(panel, giverName);
        }
        break;

      case 'giving':
        if (isGiver) {
          // I need to give a card to the asker
          this.renderGivePanel(panel);
        } else {
          const askerName = this.state.players[askerIdx]?.name || '?';
          panel.innerHTML = `<span class="action-title">${giverName} בוחר קלף לתת ל${askerName}...</span>`;
        }
        break;

      case 'believe_or_doubt':
        if (isAsker) {
          this.renderBelieveOrDoubtPanel(panel);
        } else {
          const askerName = this.state.players[askerIdx]?.name || '?';
          panel.innerHTML = `<span class="action-title">${askerName} מחליט - מאמין או לא?</span>`;
        }
        break;

      case 'doubt_second':
        if (isGiver) {
          // Giver gives 2nd card
          panel.innerHTML = `
            <span class="action-title">לא מאמינים לך! בחר קלף שני לתת</span>
            <div class="action-buttons">
              <button class="btn btn-action btn-doubt" id="btnGiveSecond">תן קלף (בחר מהיד)</button>
            </div>
          `;
          document.getElementById('btnGiveSecond').addEventListener('click', () => {
            if (!this.selectedCard) return this.showToast('בחר קלף מהיד!');
            this.socket.emit('give_second_card', {
              code: this.roomCode,
              cardId: this.selectedCard
            }, (res) => {
              if (res.error) this.showToast('שגיאה: ' + res.error);
              this.selectedCard = null;
            });
          });
        } else {
          panel.innerHTML = `<span class="action-title">ממתין לקלף שני מ${giverName}...</span>`;
        }
        break;

      case 'pick_one':
        if (isAsker) {
          this.renderPickOnePanel(panel);
        } else {
          const askerName = this.state.players[askerIdx]?.name || '?';
          panel.innerHTML = `<span class="action-title">${askerName} בוחר קלף...</span>`;
        }
        break;

      case 'doubt_third':
        if (isGiver) {
          panel.innerHTML = `
            <span class="action-title">רוצים קלף שלישי! בחר קלף (חייב לקחת אותו)</span>
            <div class="action-buttons">
              <button class="btn btn-action btn-doubt" id="btnGiveThird">תן קלף שלישי</button>
            </div>
          `;
          document.getElementById('btnGiveThird').addEventListener('click', () => {
            if (!this.selectedCard) return this.showToast('בחר קלף מהיד!');
            this.socket.emit('give_third_card', {
              code: this.roomCode,
              cardId: this.selectedCard
            }, (res) => {
              if (res.error) this.showToast('שגיאה: ' + res.error);
              this.selectedCard = null;
            });
          });
        } else if (isAsker) {
          panel.innerHTML = `<span class="action-title">ממתין לקלף השלישי... (חייב לקחת!)</span>`;
        } else {
          panel.innerHTML = `<span class="action-title">ממתין לקלף שלישי...</span>`;
        }
        break;

      default:
        panel.classList.add('hidden');
    }
  }

  renderAskPanel(panel, giverName) {
    const values = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    panel.innerHTML = `
      <span class="action-title">בקש מ${giverName}: "תביא לי..."</span>
      <div class="value-grid">
        ${values.map(v => `<button class="btn-value" data-value="${v}">${getValueName(v)}</button>`).join('')}
      </div>
    `;

    panel.querySelectorAll('.btn-value').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;
        this.socket.emit('ask_giver', { code: this.roomCode, value }, (res) => {
          if (res.error) this.showToast('שגיאה: ' + res.error);
        });
      });
    });
  }

  renderGivePanel(panel) {
    const askerName = this.state.players[this.state.askerIdx]?.name || '?';
    const askedValue = this.state.askedValue;
    panel.innerHTML = `
      <span class="action-title">${askerName} מבקש: "${getValueName(askedValue)}" — בחר קלף לתת (אמת או בלוף!)</span>
      <div class="action-buttons">
        <button class="btn btn-action btn-believe" id="btnGiveCard">תן קלף (בחר מהיד)</button>
      </div>
    `;

    document.getElementById('btnGiveCard').addEventListener('click', () => {
      if (!this.selectedCard) return this.showToast('בחר קלף מהיד!');
      this.socket.emit('give_card', {
        code: this.roomCode,
        cardId: this.selectedCard
      }, (res) => {
        if (res.error) this.showToast('שגיאה: ' + res.error);
        this.selectedCard = null;
      });
    });
  }

  renderBelieveOrDoubtPanel(panel) {
    panel.innerHTML = `
      <span class="action-title">קלף הגיע אליך! מאמין או לא?</span>
      <div class="action-buttons">
        <button class="btn btn-action btn-believe" id="btnBelieve">✅ מאמין</button>
        <button class="btn btn-action btn-doubt" id="btnDoubt">❌ לא מאמין</button>
      </div>
    `;

    document.getElementById('btnBelieve').addEventListener('click', () => {
      this.socket.emit('believe', { code: this.roomCode }, (res) => {
        if (res.error) this.showToast('שגיאה: ' + res.error);
        if (res.cardReceived) {
          this.showToast(`קיבלת: ${getValueName(res.cardReceived.value)} ${res.cardReceived.suit}`);
        }
      });
    });

    document.getElementById('btnDoubt').addEventListener('click', () => {
      this.socket.emit('doubt', { code: this.roomCode }, (res) => {
        if (res.error) this.showToast('שגיאה: ' + res.error);
      });
    });
  }

  renderPickOnePanel(panel) {
    panel.innerHTML = `
      <span class="action-title">בחר אחד משני הקלפים (הפוכים):</span>
      <div class="face-down-choice">
        <div class="card card-back" id="pickCard0" style="cursor:pointer"></div>
        <div class="card card-back" id="pickCard1" style="cursor:pointer"></div>
      </div>
      <button class="btn btn-action btn-doubt" id="btnDoubtAgain" style="margin-top:4px">🤔 עדיין חושד - קלף שלישי!</button>
    `;

    document.getElementById('pickCard0').addEventListener('click', () => {
      this.socket.emit('pick_card', { code: this.roomCode, pickIndex: 0 }, (res) => {
        if (res.error) this.showToast('שגיאה: ' + res.error);
        if (res.pickedCard) this.showToast(`בחרת: ${getValueName(res.pickedCard.value)} ${res.pickedCard.suit}`);
      });
    });

    document.getElementById('pickCard1').addEventListener('click', () => {
      this.socket.emit('pick_card', { code: this.roomCode, pickIndex: 1 }, (res) => {
        if (res.error) this.showToast('שגיאה: ' + res.error);
        if (res.pickedCard) this.showToast(`בחרת: ${getValueName(res.pickedCard.value)} ${res.pickedCard.suit}`);
      });
    });

    document.getElementById('btnDoubtAgain').addEventListener('click', () => {
      this.socket.emit('doubt_again', { code: this.roomCode }, (res) => {
        if (res.error) this.showToast('שגיאה: ' + res.error);
      });
    });
  }

  logAction(msg, highlight = false) {
    const div = document.createElement('div');
    div.classList.add('log-msg');
    if (highlight) div.classList.add('highlight');
    div.textContent = msg;

    while (this.els.actionLog.children.length >= 3) {
      this.els.actionLog.removeChild(this.els.actionLog.firstChild);
    }
    this.els.actionLog.appendChild(div);
  }

  showToast(msg) {
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  showGameOver(data) {
    const title = document.getElementById('gameOverTitle');
    const details = document.getElementById('gameOverDetails');

    if (data.winner === this.myIndex) {
      title.textContent = '🎉 ניצחת!';
      title.style.color = 'var(--gold)';
    } else if (data.jokerHolder === this.myIndex) {
      title.textContent = '😱 הפסדת! הג\'וקר אצלך!';
      title.style.color = 'var(--accent)';
    } else {
      title.textContent = 'המשחק נגמר!';
    }

    details.innerHTML = `
      <p class="winner-text">🏆 מנצח: ${data.winnerName}</p>
      ${data.jokerHolderName ? `<p class="loser-text">🃏 הג'וקר נשאר אצל: ${data.jokerHolderName}</p>` : ''}
    `;
  }
}

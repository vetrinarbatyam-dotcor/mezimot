// Card rendering utilities

const SUIT_SYMBOLS = {
  '♠': { symbol: '♠', color: 'black', name: 'עלה' },
  '♥': { symbol: '♥', color: 'red', name: 'לב' },
  '♦': { symbol: '♦', color: 'red', name: 'יהלום' },
  '♣': { symbol: '♣', color: 'black', name: 'תלתן' }
};

const VALUE_DISPLAY = {
  '7': '7', '8': '8', '9': '9', '10': '10',
  'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A'
};

const VALUE_NAMES = {
  '7': '7', '8': '8', '9': '9', '10': '10',
  'J': 'נסיך', 'Q': 'מלכה', 'K': 'מלך', 'A': 'אס'
};

function createCardElement(card, faceUp = true) {
  const el = document.createElement('div');
  el.classList.add('card');
  el.dataset.cardId = card.id;

  if (!faceUp) {
    el.classList.add('card-back');
    return el;
  }

  if (card.value === 'JOKER') {
    el.classList.add('card-joker');
    el.innerHTML = `
      <span class="card-suit">🃏</span>
      <span class="card-value">ג'וקר</span>
    `;
    return el;
  }

  const suitInfo = SUIT_SYMBOLS[card.suit];
  const isRed = suitInfo.color === 'red';

  el.classList.add('card-front');
  if (isRed) el.classList.add('red');

  el.innerHTML = `
    <span class="card-corner top">${VALUE_DISPLAY[card.value]}${suitInfo.symbol}</span>
    <span class="card-suit">${suitInfo.symbol}</span>
    <span class="card-value">${VALUE_DISPLAY[card.value]}</span>
    <span class="card-corner bottom">${VALUE_DISPLAY[card.value]}${suitInfo.symbol}</span>
  `;

  return el;
}

function createCardBackElement() {
  const el = document.createElement('div');
  el.classList.add('card', 'card-back');
  return el;
}

function getValueName(value) {
  return VALUE_NAMES[value] || value;
}

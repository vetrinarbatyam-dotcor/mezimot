// Game engine for Mezimot card game

const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUE_NAMES_HE = {
  '7': '7', '8': '8', '9': '9', '10': '10',
  'J': 'נסיך', 'Q': 'מלכה', 'K': 'מלך', 'A': 'אס'
};

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value, id: `${value}${suit}` });
    }
  }
  // Add Joker
  deck.push({ suit: '🃏', value: 'JOKER', id: 'JOKER' });
  return deck;
}

function shuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealCards(deck, playerCount, startingPlayer = 0) {
  const hands = Array.from({ length: playerCount }, () => []);
  let cardIdx = 0;
  // Deal 4 cards to each player
  for (let p = 0; p < playerCount; p++) {
    for (let c = 0; c < 4; c++) {
      if (cardIdx < deck.length) {
        hands[p].push(deck[cardIdx++]);
      }
    }
  }
  // 5th card to starting player
  if (cardIdx < deck.length) {
    hands[startingPlayer].push(deck[cardIdx++]);
  }
  return hands;
}

// Check if player has a quartet (4 cards of same value)
function findQuartets(hand) {
  const counts = {};
  for (const card of hand) {
    if (card.value === 'JOKER') continue;
    counts[card.value] = (counts[card.value] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count === 4)
    .map(([value]) => value);
}

// Remove quartet cards from hand
function removeQuartet(hand, value) {
  const removed = [];
  const remaining = [];
  for (const card of hand) {
    if (card.value === value && removed.length < 4) {
      removed.push(card);
    } else {
      remaining.push(card);
    }
  }
  return { remaining, removed };
}

// Get the chain of players between source and target (going left)
// Players sit in a circle: 0, 1, 2, 3, 4 ...
// Cards flow: right → left (each player gives to their left neighbor)
// If player 0 asks and player 3 volunteers, chain is: 3→2→1→0
function getChain(sourceIdx, targetIdx, playerCount) {
  const chain = [];
  let current = sourceIdx;
  while (current !== targetIdx) {
    // Move left (decrement, wrap around)
    current = (current - 1 + playerCount) % playerCount;
    if (current !== targetIdx) {
      chain.push(current);
    }
  }
  return chain;
}

// Get the right neighbor of a player
function getRightNeighbor(playerIdx, playerCount) {
  return (playerIdx + 1) % playerCount;
}

// Get the left neighbor of a player
function getLeftNeighbor(playerIdx, playerCount) {
  return (playerIdx - 1 + playerCount) % playerCount;
}

// Game state machine
// The active player (5 cards) is the GIVER.
// Another player asks them for a value, the giver gives a card face-down.
const PHASES = {
  ASKING: 'asking',           // Other players ask the giver "give me [value]"
  GIVING: 'giving',           // Giver picks a card to give (truth or bluff)
  BELIEVE_OR_DOUBT: 'believe_or_doubt', // Asker decides: believe or doubt
  DOUBT_SECOND: 'doubt_second', // Giver gives 2nd card
  PICK_ONE: 'pick_one',       // Asker picks one of two
  DOUBT_THIRD: 'doubt_third', // Giver gives 3rd card (must take)
  TURN_END: 'turn_end',       // Check quartets, next turn
  GAME_OVER: 'game_over'
};

class Game {
  constructor(players) {
    this.players = players; // [{id, name, isAI}]
    this.hands = [];
    this.quartets = []; // [{playerIdx, value, cards}]
    this.currentTurn = 0;
    this.phase = null;
    this.deck = [];

    // Turn state
    this.askedValue = null;
    this.volunteerIdx = null;
    this.chainCards = []; // Cards offered during believe/doubt
    this.chain = [];
    this.chainPosition = 0;
    this.currentChainCard = null;

    // Doubt state
    this.doubtCards = []; // Cards available to pick from
  }

  start() {
    this.deck = shuffle(createDeck());
    this.currentTurn = 0; // Starting player gets 5 cards
    this.hands = dealCards(this.deck, this.players.length, this.currentTurn);

    // Auto-place any quartets dealt
    for (let i = 0; i < this.players.length; i++) {
      this.checkAndPlaceQuartets(i);
    }

    this.phase = PHASES.ASKING;

    return {
      hands: this.hands,
      currentTurn: this.currentTurn,
      phase: this.phase,
      players: this.players
    };
  }

  checkAndPlaceQuartets(playerIdx) {
    const placed = [];
    let quartetValues = findQuartets(this.hands[playerIdx]);
    while (quartetValues.length > 0) {
      const value = quartetValues[0];
      const { remaining, removed } = removeQuartet(this.hands[playerIdx], value);
      this.hands[playerIdx] = remaining;
      this.quartets.push({ playerIdx, value, cards: removed });
      placed.push({ playerIdx, value, cards: removed });
      quartetValues = findQuartets(this.hands[playerIdx]);
    }
    return placed;
  }

  // Phase: ASKING - another player asks the giver for a value
  // The giver (currentTurn) has 5 cards. An asker requests a value from them.
  askGiver(askerIdx, value) {
    if (this.phase !== PHASES.ASKING) return { error: 'not_asking_phase' };
    if (askerIdx === this.currentTurn) return { error: 'giver_cannot_ask_self' };
    if (!VALUES.includes(value) && value !== 'JOKER') return { error: 'invalid_value' };

    this.askedValue = value;
    this.askerIdx = askerIdx;
    this.phase = PHASES.GIVING;

    return {
      success: true,
      askerIdx,
      giverIdx: this.currentTurn,
      value,
      phase: this.phase
    };
  }

  // Phase: GIVING - the giver (5 cards) picks a card to give face-down
  giveCard(giverIdx, cardId) {
    if (this.phase !== PHASES.GIVING) return { error: 'not_giving_phase' };
    if (giverIdx !== this.currentTurn) return { error: 'not_the_giver' };

    const cardIndex = this.hands[giverIdx].findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { error: 'card_not_in_hand' };

    const card = this.hands[giverIdx].splice(cardIndex, 1)[0];
    this.givenCard = card;

    this.phase = PHASES.BELIEVE_OR_DOUBT;

    return {
      success: true,
      giverIdx,
      askerIdx: this.askerIdx,
      phase: this.phase,
      cardGiven: true // card identity hidden from asker
    };
  }

  // Phase: BELIEVE_OR_DOUBT - asker decides
  believe(playerIdx) {
    if (this.phase !== PHASES.BELIEVE_OR_DOUBT) return { error: 'not_believe_phase' };
    if (playerIdx !== this.askerIdx) return { error: 'not_the_asker' };

    const card = this.givenCard;
    this.hands[playerIdx].push(card);

    // Check for quartets for the asker
    const placed = this.checkAndPlaceQuartets(playerIdx);

    // Check win condition
    const gameOver = this.checkGameOver();

    if (!gameOver) {
      // The asker now has 5 cards → they become the giver
      this.advanceTurn(playerIdx);
    }

    return {
      success: true,
      cardReceived: card,
      quartetsPlaced: placed,
      gameOver,
      phase: this.phase,
      currentTurn: this.currentTurn
    };
  }

  doubt(playerIdx) {
    if (this.phase !== PHASES.BELIEVE_OR_DOUBT) return { error: 'not_believe_phase' };
    if (playerIdx !== this.askerIdx) return { error: 'not_the_asker' };

    // Giver must give a second card
    if (this.hands[this.currentTurn].length === 0) {
      // Giver has no more cards, must believe
      return this.believe(playerIdx);
    }

    this.phase = PHASES.DOUBT_SECOND;
    this.doubtCards = [this.givenCard]; // First card

    return {
      success: true,
      phase: this.phase,
      giverIdx: this.currentTurn
    };
  }

  // Giver gives second card for doubt
  giveSecondCard(giverIdx, cardId) {
    if (this.phase !== PHASES.DOUBT_SECOND) return { error: 'not_doubt_second_phase' };
    if (giverIdx !== this.currentTurn) return { error: 'not_the_giver' };

    const cardIndex = this.hands[giverIdx].findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { error: 'card_not_in_hand' };

    const card = this.hands[giverIdx].splice(cardIndex, 1)[0];
    this.doubtCards.push(card);

    this.phase = PHASES.PICK_ONE;

    return {
      success: true,
      phase: this.phase,
      cardsToPickFrom: 2
    };
  }

  // Asker picks one of two cards
  pickCard(playerIdx, pickIndex) {
    if (this.phase !== PHASES.PICK_ONE) return { error: 'not_pick_phase' };
    if (playerIdx !== this.askerIdx) return { error: 'not_the_asker' };
    if (pickIndex < 0 || pickIndex >= this.doubtCards.length) return { error: 'invalid_pick' };

    const pickedCard = this.doubtCards[pickIndex];
    const returnedCard = this.doubtCards[1 - pickIndex];

    // Picked card goes to asker
    this.hands[playerIdx].push(pickedCard);

    // Returned card goes back to giver
    this.hands[this.currentTurn].push(returnedCard);

    // Check for quartets
    const placed = this.checkAndPlaceQuartets(playerIdx);
    const gameOver = this.checkGameOver();

    if (!gameOver) {
      // Asker now has 5 cards → becomes giver
      this.advanceTurn(playerIdx);
    }

    return {
      success: true,
      pickedCard,
      returnedCard,
      quartetsPlaced: placed,
      gameOver,
      phase: this.phase,
      currentTurn: this.currentTurn
    };
  }

  // Asker can request a third card instead of picking
  doubtAgain(playerIdx) {
    if (this.phase !== PHASES.PICK_ONE) return { error: 'not_pick_phase' };
    if (playerIdx !== this.askerIdx) return { error: 'not_the_asker' };

    if (this.hands[this.currentTurn].length === 0) {
      return { error: 'giver_has_no_cards' };
    }

    this.phase = PHASES.DOUBT_THIRD;

    return {
      success: true,
      phase: this.phase,
      giverIdx: this.currentTurn
    };
  }

  // Giver gives third card - asker must take it
  giveThirdCard(giverIdx, cardId) {
    if (this.phase !== PHASES.DOUBT_THIRD) return { error: 'not_doubt_third_phase' };
    if (giverIdx !== this.currentTurn) return { error: 'not_the_giver' };

    const cardIndex = this.hands[giverIdx].findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { error: 'card_not_in_hand' };

    const card = this.hands[giverIdx].splice(cardIndex, 1)[0];

    // Return the first two doubt cards to giver
    for (const dc of this.doubtCards) {
      this.hands[this.currentTurn].push(dc);
    }

    // Third card must be taken by asker
    this.hands[this.askerIdx].push(card);

    // Check for quartets
    const placed = this.checkAndPlaceQuartets(this.askerIdx);
    const gameOver = this.checkGameOver();

    if (!gameOver) {
      // Asker now has 5 → becomes giver
      this.advanceTurn(this.askerIdx);
    }

    return {
      success: true,
      cardReceived: card,
      quartetsPlaced: placed,
      gameOver,
      phase: this.phase,
      currentTurn: this.currentTurn
    };
  }

  // Advance turn: the player who received the card (now has 5) becomes the giver
  advanceTurn(newGiverIdx) {
    this.currentTurn = newGiverIdx;
    this.phase = PHASES.ASKING;
    this.askedValue = null;
    this.askerIdx = null;
    this.givenCard = null;
    this.doubtCards = [];
  }

  nextTurn() {
    // Fallback: rotate to next player with cards
    let next = (this.currentTurn + 1) % this.players.length;
    let attempts = 0;
    while (this.hands[next].length === 0 && attempts < this.players.length) {
      next = (next + 1) % this.players.length;
      attempts++;
    }
    this.advanceTurn(next);
  }

  checkGameOver() {
    // Game over when any player has 0 cards
    for (let i = 0; i < this.players.length; i++) {
      if (this.hands[i].length === 0) {
        // Find who has the Joker
        let jokerHolder = -1;
        for (let j = 0; j < this.players.length; j++) {
          if (this.hands[j].some(c => c.value === 'JOKER')) {
            jokerHolder = j;
            break;
          }
        }

        this.phase = PHASES.GAME_OVER;

        return {
          winner: i,
          winnerName: this.players[i].name,
          jokerHolder,
          jokerHolderName: jokerHolder >= 0 ? this.players[jokerHolder].name : null
        };
      }
    }
    return null;
  }

  // Get sanitized state for a specific player (hides other players' cards)
  getStateForPlayer(playerIdx) {
    return {
      hand: this.hands[playerIdx],
      players: this.players.map((p, i) => ({
        ...p,
        cardCount: this.hands[i].length,
        idx: i
      })),
      quartets: this.quartets,
      currentTurn: this.currentTurn, // The giver (5 cards)
      phase: this.phase,
      askedValue: this.askedValue,
      askerIdx: this.askerIdx,
      giverIdx: this.currentTurn,
      myIndex: playerIdx
    };
  }
}

module.exports = { Game, PHASES, VALUES, VALUE_NAMES_HE, SUITS, createDeck, shuffle };

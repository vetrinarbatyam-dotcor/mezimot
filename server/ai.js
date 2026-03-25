// AI opponent logic for Mezimot

const { VALUES } = require('./game');

class AIPlayer {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty; // 'easy', 'medium', 'hard'
    this.memory = {}; // Track what cards have been asked for
  }

  // Decide what value to ask for
  decideAsk(hand) {
    // Count how many of each value we have
    const counts = {};
    for (const card of hand) {
      if (card.value === 'JOKER') continue;
      counts[card.value] = (counts[card.value] || 0) + 1;
    }

    // Prefer values we have 2-3 of (close to quartet)
    const priorities = Object.entries(counts)
      .sort((a, b) => b[1] - a[1]);

    if (priorities.length === 0) {
      // Only joker left, ask for anything
      return VALUES[Math.floor(Math.random() * VALUES.length)];
    }

    if (this.difficulty === 'easy') {
      // Random value from hand
      return priorities[Math.floor(Math.random() * priorities.length)][0];
    }

    // Medium/Hard: ask for what we have most of
    return priorities[0][0];
  }

  // Decide which card to give when asked for a value (giver role)
  decideGiveCard(hand, askedValue) {
    const hasAskedCard = hand.some(c => c.value === askedValue);
    const joker = hand.find(c => c.value === 'JOKER');

    if (this.difficulty === 'easy') {
      // Easy: give the asked card if we have it, otherwise random
      if (hasAskedCard) return hand.find(c => c.value === askedValue);
      return hand[Math.floor(Math.random() * hand.length)];
    }

    if (this.difficulty === 'hard') {
      // Try to pass the Joker via bluff
      if (joker && !hasAskedCard && Math.random() < 0.5) return joker;
      if (hasAskedCard) {
        // 70% honest, 30% bluff
        if (Math.random() < 0.7) return hand.find(c => c.value === askedValue);
        const others = hand.filter(c => c.value !== askedValue);
        if (others.length > 0) return others[Math.floor(Math.random() * others.length)];
        return hand.find(c => c.value === askedValue);
      }
      // Don't have it: give random (bluff)
      if (joker && Math.random() < 0.4) return joker;
      return hand[Math.floor(Math.random() * hand.length)];
    }

    // Medium: sometimes honest, sometimes bluff
    if (hasAskedCard) {
      if (Math.random() < 0.8) return hand.find(c => c.value === askedValue);
      const others = hand.filter(c => c.value !== askedValue);
      if (others.length > 0) return others[Math.floor(Math.random() * others.length)];
      return hand.find(c => c.value === askedValue);
    }
    // Don't have it: give random
    if (joker && Math.random() < 0.3) return joker;
    return hand[Math.floor(Math.random() * hand.length)];
  }

  // Decide which card to volunteer when someone asks (legacy - kept for compatibility)
  decideVolunteer(hand, askedValue, askerIdx, myIdx) {
    const hasAskedCard = hand.some(c => c.value === askedValue);
    const joker = hand.find(c => c.value === 'JOKER');

    if (this.difficulty === 'easy') {
      // Easy: always give the asked card if we have it, otherwise random
      if (hasAskedCard) {
        return hand.find(c => c.value === askedValue);
      }
      return null; // Don't volunteer
    }

    if (this.difficulty === 'hard') {
      // Hard: strategic - try to pass the Joker via bluff
      if (joker && !hasAskedCard && Math.random() < 0.4) {
        return joker; // Bluff with Joker!
      }
      if (hasAskedCard) {
        return hand.find(c => c.value === askedValue);
      }
      return null;
    }

    // Medium: sometimes honest, sometimes bluff
    if (hasAskedCard) {
      // 80% honest
      if (Math.random() < 0.8) {
        return hand.find(c => c.value === askedValue);
      }
      // 20% bluff with different card
      const otherCards = hand.filter(c => c.value !== askedValue);
      if (otherCards.length > 0) {
        return otherCards[Math.floor(Math.random() * otherCards.length)];
      }
      return hand.find(c => c.value === askedValue);
    }

    // Don't have the card — bluff sometimes
    if (Math.random() < 0.3) {
      // Give a random card and claim it's what they asked
      if (joker && Math.random() < 0.5) return joker;
      return hand[Math.floor(Math.random() * hand.length)];
    }

    return null; // Don't volunteer
  }

  // Decide whether to swap card in chain pass
  decideChainSwap(hand, passingCard) {
    if (this.difficulty === 'easy') return null; // Never swap

    const joker = hand.find(c => c.value === 'JOKER');

    // Hard: swap joker in if possible
    if (this.difficulty === 'hard' && joker && passingCard.value !== 'JOKER' && Math.random() < 0.5) {
      return joker;
    }

    // Medium: occasional swap
    if (Math.random() < 0.15) {
      return hand[Math.floor(Math.random() * hand.length)];
    }

    return null; // Pass through
  }

  // Decide: believe or doubt
  decideBelieveOrDoubt(askedValue, volunteeredBy, myHand) {
    if (this.difficulty === 'easy') {
      return Math.random() < 0.7 ? 'believe' : 'doubt';
    }

    if (this.difficulty === 'hard') {
      // Check if we already have 3 of this value - if so, the volunteer is probably bluffing
      const count = myHand.filter(c => c.value === askedValue).length;
      if (count >= 3) return 'doubt'; // We have 3, unlikely they have the 4th
      return Math.random() < 0.6 ? 'believe' : 'doubt';
    }

    // Medium
    return Math.random() < 0.55 ? 'believe' : 'doubt';
  }

  // Decide which card to give when doubted (2nd or 3rd card)
  decideGiveForDoubt(hand) {
    const joker = hand.find(c => c.value === 'JOKER');

    if (this.difficulty === 'hard' && joker && Math.random() < 0.4) {
      return joker;
    }

    // Give random card
    return hand[Math.floor(Math.random() * hand.length)];
  }

  // Pick one of two cards
  decidePickCard() {
    return Math.floor(Math.random() * 2); // Random pick 0 or 1
  }

  // Decide whether to doubt again (ask for 3rd card)
  decideDoubtAgain() {
    if (this.difficulty === 'easy') return false;
    if (this.difficulty === 'hard') return Math.random() < 0.3;
    return Math.random() < 0.15;
  }
}

module.exports = { AIPlayer };

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { RoomManager } = require('./room');
const { PHASES, VALUES } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomManager = new RoomManager();

app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Socket.IO ---

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Create room
  socket.on('create_room', ({ name }, cb) => {
    const { code, room } = roomManager.createRoom(socket.id, name);
    socket.join(code);
    cb({ code, players: room.players });
  });

  // Join room
  socket.on('join_room', ({ code, name }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room) return cb({ error: 'room_not_found' });

    const result = room.addPlayer(socket.id, name);
    if (result.error) return cb({ error: result.error });

    socket.join(code);
    io.to(code).emit('player_joined', { players: room.players });
    cb({ success: true, players: room.players });
  });

  // Add AI player
  socket.on('add_ai', ({ code, name, difficulty }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room) return cb({ error: 'room_not_found' });
    if (socket.id !== room.hostId) return cb({ error: 'not_host' });

    if (difficulty) room.aiDifficulty = difficulty;
    const result = room.addAI(name);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('player_joined', { players: room.players });
    cb({ success: true, players: room.players });
  });

  // Start game
  socket.on('start_game', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room) return cb({ error: 'room_not_found' });
    if (socket.id !== room.hostId) return cb({ error: 'not_host' });

    const result = room.startGame();
    if (result.error) return cb({ error: result.error });

    // Send each player their own hand
    for (let i = 0; i < room.players.length; i++) {
      const p = room.players[i];
      if (!p.isAI) {
        const state = room.game.getStateForPlayer(i);
        io.to(p.socketId).emit('game_started', state);
      }
    }

    // If the giver is AI, wait for someone to ask.
    // If the giver is human, they wait. Other players (AI) may ask.
    scheduleAIAsk(code);
  });

  // Ask giver: "give me [value]" - any non-giver player can ask
  socket.on('ask_giver', ({ code, value }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const askerIdx = room.getPlayerIndex(socket.id);
    const result = room.game.askGiver(askerIdx, value);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('someone_asked', {
      askerIdx,
      askerName: room.players[askerIdx].name,
      giverIdx: result.giverIdx,
      giverName: room.players[result.giverIdx].name,
      value
    });

    cb({ success: true });
    broadcastState(code);

    // If giver is AI, they need to give a card
    processAIGive(code);
  });

  // Giver gives a card face-down
  socket.on('give_card', ({ code, cardId }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const giverIdx = room.getPlayerIndex(socket.id);
    const result = room.game.giveCard(giverIdx, cardId);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('card_given', {
      giverIdx,
      giverName: room.players[giverIdx].name,
      askerIdx: result.askerIdx,
      phase: result.phase
    });

    cb({ success: true });
    broadcastState(code);

    // If asker is AI, they decide believe/doubt
    processAIBelieveOrDoubt(code);
  });

  // Believe
  socket.on('believe', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const playerIdx = room.getPlayerIndex(socket.id);
    const result = room.game.believe(playerIdx);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('card_believed', {
      playerIdx,
      cardReceived: result.cardReceived,
      quartetsPlaced: result.quartetsPlaced,
      gameOver: result.gameOver
    });

    cb({ success: true, cardReceived: result.cardReceived });
    broadcastState(code);

    if (result.gameOver) {
      handleGameOver(code, result.gameOver);
    } else {
      // Asker now has 5 cards, becomes giver. Others can ask.
      scheduleAIAsk(code);
    }
  });

  // Doubt
  socket.on('doubt', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const playerIdx = room.getPlayerIndex(socket.id);
    const result = room.game.doubt(playerIdx);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('player_doubted', {
      playerIdx,
      phase: result.phase,
      giverIdx: result.giverIdx
    });

    cb({ success: true });
    broadcastState(code);

    // Giver needs to give 2nd card
    if (result.phase === PHASES.DOUBT_SECOND) {
      processAIDoubtGive(code, 'second');
    }
  });

  // Giver gives second card (when doubted)
  socket.on('give_second_card', ({ code, cardId }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const giverIdx = room.getPlayerIndex(socket.id);
    const result = room.game.giveSecondCard(giverIdx, cardId);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('second_card_given', { phase: result.phase });
    cb({ success: true });
    broadcastState(code);

    // If asker is AI, they pick
    processAIPick(code);
  });

  // Pick one of two cards
  socket.on('pick_card', ({ code, pickIndex }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const playerIdx = room.getPlayerIndex(socket.id);
    const result = room.game.pickCard(playerIdx, pickIndex);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('card_picked', {
      playerIdx,
      quartetsPlaced: result.quartetsPlaced,
      gameOver: result.gameOver
    });

    cb({ success: true, pickedCard: result.pickedCard });
    broadcastState(code);

    if (result.gameOver) {
      handleGameOver(code, result.gameOver);
    } else {
      scheduleAIAsk(code);
    }
  });

  // Doubt again (request 3rd card)
  socket.on('doubt_again', ({ code }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const playerIdx = room.getPlayerIndex(socket.id);
    const result = room.game.doubtAgain(playerIdx);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('player_doubted_again', {
      playerIdx,
      phase: result.phase,
      giverIdx: result.giverIdx
    });

    cb({ success: true });
    broadcastState(code);

    processAIDoubtGive(code, 'third');
  });

  // Giver gives third card
  socket.on('give_third_card', ({ code, cardId }, cb) => {
    const room = roomManager.getRoom(code);
    if (!room || !room.game) return cb({ error: 'no_game' });

    const giverIdx = room.getPlayerIndex(socket.id);
    const result = room.game.giveThirdCard(giverIdx, cardId);
    if (result.error) return cb({ error: result.error });

    io.to(code).emit('third_card_taken', {
      playerIdx: room.game.askerIdx,
      cardReceived: result.cardReceived,
      quartetsPlaced: result.quartetsPlaced,
      gameOver: result.gameOver
    });

    cb({ success: true });
    broadcastState(code);

    if (result.gameOver) {
      handleGameOver(code, result.gameOver);
    } else {
      scheduleAIAsk(code);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    const found = roomManager.getRoomByPlayerId(socket.id);
    if (found) {
      const { code, room } = found;
      if (room.state === 'waiting') {
        room.removePlayer(socket.id);
        io.to(code).emit('player_left', { players: room.players });
        if (room.players.length === 0) {
          roomManager.deleteRoom(code);
        }
      }
    }
  });
});

// --- AI Processing ---

function broadcastState(code) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game) return;

  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (!p.isAI) {
      const state = room.game.getStateForPlayer(i);
      io.to(p.socketId).emit('state_update', state);
    }
  }
}

// When it's ASKING phase, an AI (non-giver) can ask the giver for a card
function scheduleAIAsk(code) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game || room.game.phase !== PHASES.ASKING) return;

  const giverIdx = room.game.currentTurn;

  // Find AI players who can ask (not the giver)
  const aiAskers = [];
  for (let i = 0; i < room.players.length; i++) {
    if (i === giverIdx) continue;
    if (!room.players[i].isAI) continue;
    if (room.game.hands[i].length === 0) continue;
    aiAskers.push(i);
  }

  if (aiAskers.length === 0) return; // Human players will ask

  // Check if there are any human non-giver players who could ask
  const humanAskers = room.players.filter((p, i) => i !== giverIdx && !p.isAI && room.game.hands[i].length > 0);

  if (humanAskers.length > 0) {
    // Let humans ask first, AI asks after timeout
    room.askTimer = setTimeout(() => {
      if (room.game && room.game.phase === PHASES.ASKING) {
        doAIAsk(code, aiAskers);
      }
    }, 8000);
  } else {
    // Only AI askers, pick one after short delay
    setTimeout(() => doAIAsk(code, aiAskers), 1500);
  }
}

function doAIAsk(code, aiAskers) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game || room.game.phase !== PHASES.ASKING) return;
  if (aiAskers.length === 0) return;

  // Pick a random AI to ask
  const askerIdx = aiAskers[Math.floor(Math.random() * aiAskers.length)];
  const ai = room.getAIPlayerInstance(askerIdx);
  if (!ai) return;

  const hand = room.game.hands[askerIdx];
  const value = ai.decideAsk(hand);
  const result = room.game.askGiver(askerIdx, value);

  if (result.success) {
    io.to(code).emit('someone_asked', {
      askerIdx,
      askerName: room.players[askerIdx].name,
      giverIdx: result.giverIdx,
      giverName: room.players[result.giverIdx].name,
      value
    });

    broadcastState(code);

    // Now giver needs to give a card
    processAIGive(code);
  }
}

// Giver (AI) picks a card to give
function processAIGive(code) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game || room.game.phase !== PHASES.GIVING) return;

  const giverIdx = room.game.currentTurn;
  if (!room.players[giverIdx].isAI) return;

  const ai = room.getAIPlayerInstance(giverIdx);
  if (!ai) return;

  setTimeout(() => {
    const hand = room.game.hands[giverIdx];
    if (hand.length === 0) return;

    // AI decides which card to give (truth or bluff)
    const card = ai.decideGiveCard(hand, room.game.askedValue);
    const result = room.game.giveCard(giverIdx, card.id);

    if (result.success) {
      io.to(code).emit('card_given', {
        giverIdx,
        giverName: room.players[giverIdx].name,
        askerIdx: result.askerIdx,
        phase: result.phase
      });

      broadcastState(code);
      processAIBelieveOrDoubt(code);
    }
  }, 1500);
}

function processAIBelieveOrDoubt(code) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game || room.game.phase !== PHASES.BELIEVE_OR_DOUBT) return;

  const askerIdx = room.game.askerIdx;
  if (!room.players[askerIdx].isAI) return;

  const ai = room.getAIPlayerInstance(askerIdx);
  if (!ai) return;

  setTimeout(() => {
    const hand = room.game.hands[askerIdx];
    const decision = ai.decideBelieveOrDoubt(room.game.askedValue, room.game.currentTurn, hand);

    if (decision === 'believe') {
      const result = room.game.believe(askerIdx);
      io.to(code).emit('card_believed', {
        playerIdx: askerIdx,
        cardReceived: result.cardReceived,
        quartetsPlaced: result.quartetsPlaced,
        gameOver: result.gameOver
      });
      broadcastState(code);
      if (result.gameOver) {
        handleGameOver(code, result.gameOver);
      } else {
        scheduleAIAsk(code);
      }
    } else {
      const result = room.game.doubt(askerIdx);
      io.to(code).emit('player_doubted', {
        playerIdx: askerIdx,
        phase: result.phase
      });
      broadcastState(code);
      if (result.phase === PHASES.DOUBT_SECOND) {
        processAIDoubtGive(code, 'second');
      }
    }
  }, 2000);
}

function processAIDoubtGive(code, which) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game) return;

  const giverIdx = room.game.currentTurn;
  if (!room.players[giverIdx].isAI) return;

  const ai = room.getAIPlayerInstance(giverIdx);
  if (!ai) return;

  setTimeout(() => {
    const hand = room.game.hands[giverIdx];
    if (hand.length === 0) return;

    const card = ai.decideGiveForDoubt(hand);

    if (which === 'second') {
      const result = room.game.giveSecondCard(giverIdx, card.id);
      if (result.success) {
        io.to(code).emit('second_card_given', { phase: result.phase });
        broadcastState(code);
        processAIPick(code);
      }
    } else {
      const result = room.game.giveThirdCard(giverIdx, card.id);
      if (result.success) {
        io.to(code).emit('third_card_taken', {
          playerIdx: room.game.askerIdx,
          cardReceived: result.cardReceived,
          quartetsPlaced: result.quartetsPlaced,
          gameOver: result.gameOver
        });
        broadcastState(code);
        if (result.gameOver) {
          handleGameOver(code, result.gameOver);
        } else {
          scheduleAIAsk(code);
        }
      }
    }
  }, 1500);
}

function processAIPick(code) {
  const room = roomManager.getRoom(code);
  if (!room || !room.game || room.game.phase !== PHASES.PICK_ONE) return;

  const askerIdx = room.game.askerIdx;
  if (!room.players[askerIdx].isAI) return;

  const ai = room.getAIPlayerInstance(askerIdx);
  if (!ai) return;

  setTimeout(() => {
    // Decide: pick one or doubt again?
    if (ai.decideDoubtAgain()) {
      const result = room.game.doubtAgain(askerIdx);
      if (result.success) {
        io.to(code).emit('player_doubted_again', {
          playerIdx: askerIdx,
          phase: result.phase
        });
        broadcastState(code);
        processAIDoubtGive(code, 'third');
        return;
      }
    }

    const pickIndex = ai.decidePickCard();
    const result = room.game.pickCard(askerIdx, pickIndex);
    if (result.success) {
      io.to(code).emit('card_picked', {
        playerIdx: askerIdx,
        quartetsPlaced: result.quartetsPlaced,
        gameOver: result.gameOver
      });
      broadcastState(code);
      if (result.gameOver) {
        handleGameOver(code, result.gameOver);
      } else {
        scheduleAIAsk(code);
      }
    }
  }, 2000);
}

function handleGameOver(code, gameOverData) {
  const room = roomManager.getRoom(code);
  if (!room) return;

  room.state = 'finished';
  io.to(code).emit('game_over', gameOverData);
}

// --- Start Server ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mezimot server running on http://localhost:${PORT}`);
});

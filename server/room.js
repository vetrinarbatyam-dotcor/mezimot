// Room management for Mezimot

const { Game, PHASES } = require('./game');
const { AIPlayer } = require('./ai');

class Room {
  constructor(code, hostId, hostName) {
    this.code = code;
    this.hostId = hostId;
    this.players = [{ id: hostId, name: hostName, isAI: false, socketId: hostId }];
    this.state = 'waiting'; // waiting, playing, finished
    this.game = null;
    this.aiPlayers = []; // AIPlayer instances
    this.maxPlayers = 6;
    this.minPlayers = 3;
    this.volunteerTimer = null;
    this.aiDifficulty = 'medium';
  }

  addPlayer(id, name) {
    if (this.state !== 'waiting') return { error: 'game_already_started' };
    if (this.players.length >= this.maxPlayers) return { error: 'room_full' };
    if (this.players.some(p => p.id === id)) return { error: 'already_in_room' };

    this.players.push({ id, name, isAI: false, socketId: id });
    return { success: true, players: this.players };
  }

  addAI(name) {
    if (this.players.length >= this.maxPlayers) return { error: 'room_full' };

    const aiId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.players.push({ id: aiId, name: name || `בוט ${this.players.length}`, isAI: true });
    this.aiPlayers.push(new AIPlayer(this.aiDifficulty));

    return { success: true, players: this.players };
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return { error: 'not_in_room' };
    this.players.splice(idx, 1);

    // If host left, assign new host
    if (id === this.hostId && this.players.length > 0) {
      const newHost = this.players.find(p => !p.isAI);
      if (newHost) this.hostId = newHost.id;
    }

    return { success: true, players: this.players };
  }

  canStart() {
    return this.players.length >= this.minPlayers && this.state === 'waiting';
  }

  startGame() {
    if (!this.canStart()) return { error: 'cannot_start' };

    this.state = 'playing';
    this.game = new Game(this.players);
    const startData = this.game.start();

    return { success: true, ...startData };
  }

  getPlayerIndex(playerId) {
    return this.players.findIndex(p => p.id === playerId);
  }

  getAIPlayerInstance(playerIdx) {
    // AI players have indices corresponding to their position in aiPlayers array
    let aiCount = 0;
    for (let i = 0; i <= playerIdx; i++) {
      if (this.players[i].isAI) {
        if (i === playerIdx) return this.aiPlayers[aiCount];
        aiCount++;
      }
    }
    return null;
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  generateCode() {
    let code;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostId, hostName) {
    const code = this.generateCode();
    const room = new Room(code, hostId, hostName);
    this.rooms.set(code, room);
    return { code, room };
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  getRoomByPlayerId(playerId) {
    for (const [code, room] of this.rooms) {
      if (room.players.some(p => p.id === playerId)) {
        return { code, room };
      }
    }
    return null;
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }
}

module.exports = { Room, RoomManager };

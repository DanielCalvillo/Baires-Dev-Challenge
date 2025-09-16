const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");
const dotenv = require("dotenv");

// Load environment variables from the project root (.env)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();

// Enable CORS so that the web and mobile clients can connect
// Allow all origins for development
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman)
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Create an HTTP server
const httpServer = http.createServer(app);

// Create a Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      // Allow all origins
      callback(null, true);
    },
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

// ------------------------------
// In-memory Room Manager
// ------------------------------

/**
 * @typedef {Object} Player
 * @property {string} id - socket.id
 * @property {string} name - display name
 * @property {number} score
 * @property {boolean} connected - whether player is currently connected
 * @property {number} disconnectedAt - timestamp when player disconnected
 */

/**
 * @typedef {Object} RoomState
 * @property {string} id
 * @property {Player[]} players
 * @property {string|null} word
 * @property {number} round
 * @property {number} turnIndex
 * @property {Set<string>} guessedThisRound
 * @property {('lobby'|'drawing'|'intermission'|'gameover')} phase
 * @property {number|undefined} roundEndAt
 */

/** @type {Map<string, RoomState>} */
const rooms = new Map();

/** @type {Map<string, string>} socketId -> roomId */
const socketToRoom = new Map();

const MAX_PLAYERS_PER_ROOM = 8;
const ROUND_MS = 60_000; // 60s per drawing round
const INTERMISSION_MS = 3_000; // 3s between rounds
const TICK_MS = 1_000; // tick every second
const WINNING_SCORE = 10; // First player to reach this score wins
const MAX_ROUNDS = 6; // Game ends after 6 rounds

// roomId -> active interval
const roomTimers = new Map();

const prompts = [
  "Cat",
  "House",
  "Tree",
  "Car",
  "Sun",
  "Dog",
  "Boat",
  "Phone",
  "Book",
  "Computer",
  "Mountain",
  "Beach",
  "Rocket",
  "Pizza",
];

const normalize = (str) =>
  String(str || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const pickWord = () => prompts[Math.floor(Math.random() * prompts.length)];

/**
 * @param {string} roomId
 * @returns {RoomState}
 */
const getOrCreateRoom = (roomId) => {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      players: [],
      word: null,
      round: 1,
      turnIndex: 0,
      guessedThisRound: new Set(),
      phase: "lobby",
    };
    rooms.set(roomId, room);
    console.log(
      `[server] Created new room: ${roomId}, total rooms: ${rooms.size}`
    );
  } else {
    console.log(
      `[server] Found existing room: ${roomId}, players: ${room.players.length}`
    );
  }
  return room;
};

const getPublicRooms = () => {
  return Array.from(rooms.values()).map((room) => ({
    id: room.id,
    count: room.players.filter((p) => p.connected).length,
    capacity: MAX_PLAYERS_PER_ROOM,
  }));
};

const broadcastRoomsList = () => {
  const publicRooms = getPublicRooms();
  const payload = { rooms: publicRooms };
  console.log("[server] Broadcasting rooms list:", publicRooms);
  // Broadcast to all; also target subscribed channel for good measure
  io.emit("rooms:list", payload);
  io.to("__rooms__").emit("rooms:list", payload);
};

/**
 * @param {RoomState} room
 */
const broadcastRoomState = (room) => {
  const connectedPlayers = room.players.filter((p) => p.connected);
  const drawer =
    connectedPlayers.length > 0
      ? connectedPlayers[room.turnIndex % connectedPlayers.length]
      : null;
  const timeLeftMs = room.roundEndAt
    ? Math.max(0, room.roundEndAt - Date.now())
    : undefined;
  const payload = {
    roomId: room.id,
    players: connectedPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
    })),
    round: room.round,
    turnPlayerId: drawer ? drawer.id : null,
    drawerId: drawer && room.phase !== "lobby" ? drawer.id : null,
    phase: room.phase,
    timeLeft:
      typeof timeLeftMs === "number" ? Math.ceil(timeLeftMs / 1000) : undefined,
  };
  io.to(room.id).emit("room:state", payload);
};

/**
 * @param {RoomState} room
 */
const emitScoreUpdate = (room) => {
  io.to(room.id).emit("score:update", {
    roomId: room.id,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
    })),
  });
};

/**
 * Check if game should end and determine winner
 * @param {RoomState} room
 * @returns {{ended: boolean, winner?: Player, reason?: string}}
 */
const checkGameEnd = (room) => {
  // Check if 6 rounds have been completed
  if (room.round >= MAX_ROUNDS) {
    // Find player with highest score
    const topPlayer = room.players.reduce((prev, curr) =>
      curr.score > prev.score ? curr : prev
    );

    // Check for ties
    const tiedPlayers = room.players.filter((p) => p.score === topPlayer.score);
    if (tiedPlayers.length > 1) {
      return {
        ended: true,
        winner: topPlayer,
        reason: `Game ended after ${MAX_ROUNDS} rounds. It's a tie at ${topPlayer.score} points!`,
      };
    }

    return {
      ended: true,
      winner: topPlayer,
      reason: `Game ended after ${MAX_ROUNDS} rounds. ${topPlayer.name} wins with ${topPlayer.score} points!`,
    };
  }

  // Early win if someone reaches 10 points before round 6
  const winner = room.players.find((p) => p.score >= WINNING_SCORE);
  if (winner) {
    return {
      ended: true,
      winner,
      reason: `${winner.name} reached ${WINNING_SCORE} points and wins the game early!`,
    };
  }

  return { ended: false };
};

/**
 * @param {RoomState} room
 */
const startRound = (room) => {
  if (!room) return;
  if (room.players.length < 2) {
    room.phase = "lobby";
    room.word = null;
    io.to(room.id).emit("round:ended", { roomId: room.id, reason: "timeout" });
    broadcastRoomState(room);
    return;
  }
  room.phase = "drawing";
  room.guessedThisRound.clear();
  const drawer = room.players[room.turnIndex % room.players.length];
  room.word = pickWord();
  // Start main drawing countdown
  startTimer(room, ROUND_MS, () => {
    endRound(room, "timeout");
  });

  // Clear canvases for everyone at start of round
  io.to(room.id).emit("round:clear", { roomId: room.id });

  // Broadcast new state
  broadcastRoomState(room);
  broadcastRoomsList();

  // Privately send the word to the drawer
  setTimeout(() => {
    io.to(drawer.id).emit("round:word", { word: room.word });
  }, 50);
};

/**
 * Ends the current round and optionally advances to the next one.
 * @param {RoomState} room
 * @param {('guessed'|'timeout'|'skipped')} reason
 */
const endRound = (room, reason) => {
  if (!room) return;
  room.phase = "intermission";
  clearTimer(room.id);
  io.to(room.id).emit("round:ended", { roomId: room.id, reason });

  // Check if game should end
  const gameEnd = checkGameEnd(room);
  if (gameEnd.ended) {
    // Game over! Announce winner
    room.phase = "gameover";
    io.to(room.id).emit("game:over", {
      roomId: room.id,
      winner: gameEnd.winner
        ? {
            id: gameEnd.winner.id,
            name: gameEnd.winner.name,
            score: gameEnd.winner.score,
          }
        : null,
      reason: gameEnd.reason,
      finalScores: room.players
        .map((p) => ({
          id: p.id,
          name: p.name,
          score: p.score,
        }))
        .sort((a, b) => b.score - a.score),
    });
    broadcastRoomState(room);
    broadcastRoomsList();
    return;
  }

  broadcastRoomState(room);
  broadcastRoomsList();
  // Intermission countdown then rotate
  if (room.players.length >= 2) {
    startTimer(room, INTERMISSION_MS, () => {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
      room.round += 1;
      room.guessedThisRound.clear();
      room.word = null;
      startRound(room);
    });
  } else {
    room.word = null;
    room.roundEndAt = undefined;
    room.phase = "lobby";
    broadcastRoomState(room);
  }
};

// Timer helpers
const startTimer = (room, durationMs, onComplete) => {
  clearTimer(room.id);
  room.roundEndAt = Date.now() + durationMs;
  const interval = setInterval(() => {
    const remaining = (room.roundEndAt || 0) - Date.now();
    if (remaining <= 0) {
      clearTimer(room.id);
      room.roundEndAt = undefined;
      broadcastRoomState(room);
      onComplete();
    } else {
      broadcastRoomState(room);
    }
  }, TICK_MS);
  roomTimers.set(room.id, interval);
};

const clearTimer = (roomId) => {
  const timer = roomTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    roomTimers.delete(roomId);
  }
};

// Simple ping route to verify the server is up
app.get("/", (_req, res) => {
  res.send("Pictionary WebSocket server is running");
});

app.get("/status", (_req, res) => {
  res.json({
    status: "running",
    rooms: Array.from(rooms.keys()),
    roomCount: rooms.size,
    timestamp: new Date().toISOString(),
  });
});

// Handle new client connections
io.on("connection", (socket) => {
  console.log("A client connected:", socket.id);

  // Immediately send current rooms list to newly connected client
  socket.emit("rooms:list", { rooms: getPublicRooms() });

  const getPlayerFromSocket = () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return { room: null, player: null };
    const room = rooms.get(roomId);
    if (!room) return { room: null, player: null };
    const player = room.players.find((p) => p.id === socket.id) || null;
    return { room, player };
  };

  // Provide current rooms list on request
  socket.on("rooms:request", () => {
    socket.emit("rooms:list", { rooms: getPublicRooms() });
  });

  // Allow clients to subscribe to live room updates only (optional)
  socket.on("rooms:subscribe", () => {
    console.log(`[server] Client ${socket.id} subscribing to rooms`);
    socket.join("__rooms__");
    const rooms = getPublicRooms();
    console.log(`[server] Sending rooms to ${socket.id}:`, rooms);
    socket.emit("rooms:list", { rooms });
  });

  socket.on("player:join", ({ roomId, name } = {}) => {
    console.log(`[server] player:join event received:`, {
      roomId,
      name,
      socketId: socket.id,
    });

    // Validate name is provided
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      socket.emit("player:join:error", {
        message: "Name is required to join a room",
      });
      return;
    }

    const cleanRoomId = String(roomId || "lobby-1").trim() || "lobby-1";
    console.log(
      `[server] player:join - socket ${socket.id} joining room ${cleanRoomId} with name "${cleanName}"`
    );

    // Leave previous room if any
    const prevRoomId = socketToRoom.get(socket.id);
    if (prevRoomId && prevRoomId !== cleanRoomId) {
      console.log(
        `[server] Socket ${socket.id} leaving previous room ${prevRoomId}`
      );
      socket.leave(prevRoomId);
      const prevRoom = rooms.get(prevRoomId);
      if (prevRoom) {
        prevRoom.players = prevRoom.players.filter((p) => p.id !== socket.id);
        if (prevRoom.players.length === 0) {
          console.log(
            `[server] Previous room ${prevRoomId} is now empty, will delete after delay`
          );
          // Delay deletion to handle rapid reconnections
          setTimeout(() => {
            const currentPrevRoom = rooms.get(prevRoomId);
            if (currentPrevRoom && currentPrevRoom.players.length === 0) {
              console.log(
                `[server] Deleting empty previous room ${prevRoomId}`
              );
              rooms.delete(prevRoomId);
              console.log(
                `[server] Rooms after deleting previous: ${rooms.size}`
              );
              broadcastRoomsList();
            }
          }, 2000);
        } else {
          // Adjust turn index if necessary
          if (prevRoom.turnIndex >= prevRoom.players.length) {
            prevRoom.turnIndex = 0;
          }
          broadcastRoomState(prevRoom);
        }
      }
    }

    const room = getOrCreateRoom(cleanRoomId);

    // Check if this is a reconnection (same name, recently disconnected)
    const disconnectedPlayer = room.players.find(
      (p) =>
        p.name === cleanName &&
        !p.connected &&
        p.disconnectedAt &&
        Date.now() - p.disconnectedAt < 30000 // 30 second grace period
    );

    if (disconnectedPlayer) {
      // Reconnection - reclaim the player's spot
      console.log(
        `[server] Player ${cleanName} reconnecting to room ${cleanRoomId}`
      );
      disconnectedPlayer.id = socket.id;
      disconnectedPlayer.connected = true;
      disconnectedPlayer.disconnectedAt = null;
    } else {
      // New player or name change
      const existing = room.players.find((p) => p.id === socket.id);
      const activePlayerCount = room.players.filter((p) => p.connected).length;

      if (!existing && activePlayerCount >= MAX_PLAYERS_PER_ROOM) {
        socket.emit("player:join:error", {
          roomId: cleanRoomId,
          message: "Room is full",
          capacity: MAX_PLAYERS_PER_ROOM,
        });
        socket.emit("rooms:list", { rooms: getPublicRooms() });
        return;
      }

      if (existing) {
        existing.name = cleanName;
        existing.connected = true;
        existing.disconnectedAt = null;
      } else {
        // Remove any old disconnected players with same name
        room.players = room.players.filter(
          (p) => !(p.name === cleanName && !p.connected)
        );
        room.players.push({
          id: socket.id,
          name: cleanName,
          score: 0,
          connected: true,
          disconnectedAt: null,
        });
      }
    }

    socketToRoom.set(socket.id, cleanRoomId);
    socket.join(cleanRoomId);

    // System message
    io.to(cleanRoomId).emit("chat:message", {
      roomId: cleanRoomId,
      fromName: "System",
      text: `${cleanName} joined the room`,
      system: true,
    });

    // Auto-start if we have enough players and we're in lobby
    if (room.players.length >= 2 && room.phase === "lobby") {
      startRound(room);
    } else {
      broadcastRoomState(room);
    }

    console.log(
      `[server] After join - Room ${cleanRoomId} has ${room.players.length} players`
    );
    console.log(`[server] Total rooms in memory: ${rooms.size}`);
    console.log(`[server] All rooms:`, Array.from(rooms.keys()));

    broadcastRoomsList();
  });

  // Allow a player to leave the current room without disconnecting
  socket.on("player:leave", ({ roomId }) => {
    const cleanRoomId = String(roomId || "").trim();
    const mappedRoomId = socketToRoom.get(socket.id);
    const actualRoomId = cleanRoomId || mappedRoomId;
    if (!actualRoomId) return;
    const room = rooms.get(actualRoomId);
    if (!room) return;
    socket.leave(actualRoomId);
    socketToRoom.delete(socket.id);
    const index = room.players.findIndex((p) => p.id === socket.id);
    const leavingWasDrawer =
      index >= 0 && index === room.turnIndex % (room.players.length || 1);
    const leavingName = index >= 0 ? room.players[index].name : "Player";
    if (index >= 0) {
      room.players.splice(index, 1);
      if (index < room.turnIndex) {
        room.turnIndex = Math.max(0, room.turnIndex - 1);
      }
    }
    io.to(actualRoomId).emit("chat:message", {
      roomId: actualRoomId,
      fromName: "System",
      text: `${leavingName} left the room`,
      system: true,
    });
    if (room.players.length === 0) {
      rooms.delete(actualRoomId);
      broadcastRoomsList();
      return;
    }
    if (room.players.length < 2) {
      room.phase = "lobby";
      room.word = null;
      broadcastRoomState(room);
      broadcastRoomsList();
      return;
    }
    if (leavingWasDrawer && room.phase === "drawing") {
      endRound(room, "timeout");
    } else {
      broadcastRoomState(room);
      broadcastRoomsList();
    }
  });

  // Public chat (not guesses). Never leak the exact word.
  socket.on("chat:message", ({ roomId, message }) => {
    const cleanRoomId = String(roomId || "").trim();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    const text = String(message || "").trim();
    if (!text) return;
    if (room.word && normalize(text) === normalize(room.word)) {
      // Ignore messages that exactly match the secret word
      return;
    }
    io.to(cleanRoomId).emit("chat:message", {
      roomId: cleanRoomId,
      fromName: player.name,
      text,
    });
  });

  // Dedicated guess channel
  socket.on("guess:submit", ({ roomId, guess }) => {
    const cleanRoomId = String(roomId || "").trim();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    if (room.phase !== "drawing") return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    const drawer = room.players[room.turnIndex % room.players.length];
    if (!drawer) return;
    // Prevent self-guessing
    if (drawer.id === socket.id) return;

    const guessNorm = normalize(guess);
    const wordNorm = normalize(room.word);
    if (!guessNorm) return;

    // Only the first correct guesser counts
    if (room.guessedThisRound.size > 0) {
      return; // Round already solved
    }

    if (guessNorm === wordNorm) {
      // Award points: +2 to guesser, +1 to drawer
      player.score += 2;
      // Drawer may have disconnected (edge case)
      const drawerInRoom = room.players.find((p) => p.id === drawer.id);
      if (drawerInRoom) drawerInRoom.score += 1;

      room.guessedThisRound.add(socket.id);
      emitScoreUpdate(room);

      // Announce in chat
      io.to(cleanRoomId).emit("chat:message", {
        roomId: cleanRoomId,
        fromName: "System",
        text: `${player.name} guessed it!`,
        system: true,
      });

      endRound(room, "guessed");
    }
  });

  // Drawing strokes (drawer only)
  socket.on("draw:stroke", ({ roomId, points }) => {
    const cleanRoomId = String(roomId || "").trim();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    const drawer = room.players[room.turnIndex % room.players.length];
    if (!drawer || drawer.id !== socket.id) return; // Only drawer can draw
    if (!Array.isArray(points) || points.length === 0) return;
    // Do not echo back to sender to avoid double-drawing artifacts
    socket.to(cleanRoomId).emit("draw:stroke", { roomId: cleanRoomId, points });
  });

  // Clear canvas (drawer only)
  socket.on("round:clear", ({ roomId }) => {
    const cleanRoomId = String(roomId || "").trim();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    const drawer = room.players[room.turnIndex % room.players.length];
    if (!drawer || drawer.id !== socket.id) return;
    io.to(cleanRoomId).emit("round:clear", { roomId: cleanRoomId });
  });

  // Optional manual start (host can start game)
  socket.on("round:start", ({ roomId }) => {
    const room = rooms.get(String(roomId || ""));
    if (!room) return;
    if (room.players.length >= 2 && room.phase !== "drawing") {
      startRound(room);
    }
  });

  // Host can delete/close a room (skip for now: allow any drawer to close)
  socket.on("room:close", ({ roomId }) => {
    const cleanRoomId = String(roomId || "").trim();
    const room = rooms.get(cleanRoomId);
    if (!room) return;
    const drawer = room.players[room.turnIndex % room.players.length];
    if (!drawer || drawer.id !== socket.id) return; // restrict to current drawer for simplicity
    io.to(cleanRoomId).emit("chat:message", {
      roomId: cleanRoomId,
      fromName: "System",
      text: "Room was closed by the drawer.",
      system: true,
    });
    rooms.delete(cleanRoomId);
    broadcastRoomsList();
  });

  // Drawer can skip the round (no points)
  socket.on("round:skip", ({ roomId }) => {
    const room = rooms.get(String(roomId || ""));
    if (!room) return;
    const drawer = room.players[room.turnIndex % room.players.length];
    if (!drawer || drawer.id !== socket.id) return;
    endRound(room, "skipped");
  });

  // Play again after game over
  socket.on("game:restart", ({ roomId }) => {
    const room = rooms.get(String(roomId || ""));
    if (!room || room.phase !== "gameover") return;

    // Reset game state
    room.players.forEach((p) => (p.score = 0));
    room.round = 1;
    room.turnIndex = 0;
    room.word = null;
    room.guessedThisRound.clear();
    room.phase = room.players.length >= 2 ? "drawing" : "lobby";

    // Start new game if enough players
    if (room.players.length >= 2) {
      startRound(room);
    } else {
      broadcastRoomState(room);
    }

    io.to(room.id).emit("chat:message", {
      roomId: room.id,
      fromName: "System",
      text: "Game restarted! Starting fresh...",
      system: true,
    });
  });

  socket.on("disconnect", () => {
    console.log(`[server] Client disconnected: ${socket.id}`);
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      console.log(
        `[server] Disconnected socket ${socket.id} was not in any room`
      );
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      console.log(`[server] Room ${roomId} not found for disconnecting socket`);
      socketToRoom.delete(socket.id);
      return;
    }

    socketToRoom.delete(socket.id);

    const leavingPlayer = room.players.find((p) => p.id === socket.id);
    if (!leavingPlayer) return;

    const leavingWasDrawer =
      room.players[room.turnIndex % room.players.length]?.id === socket.id;
    const leavingName = leavingPlayer.name;

    // Mark player as disconnected instead of removing them
    leavingPlayer.connected = false;
    leavingPlayer.disconnectedAt = Date.now();

    console.log(
      `[server] Player ${leavingName} disconnected from room ${roomId}, keeping spot for 30 seconds`
    );

    const connectedPlayers = room.players.filter((p) => p.connected);
    if (connectedPlayers.length === 0) {
      console.log(
        `[server] Room ${roomId} has no connected players, will delete after delay`
      );
      // Add a delay before deleting empty rooms to handle reconnections
      setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (currentRoom) {
          const stillConnected = currentRoom.players.filter((p) => p.connected);
          if (stillConnected.length === 0) {
            console.log(`[server] Deleting empty room ${roomId}`);
            rooms.delete(roomId);
            console.log(`[server] Rooms after deletion: ${rooms.size} total`);
            broadcastRoomsList();
          } else {
            console.log(
              `[server] Room ${roomId} has reconnected players, keeping it`
            );
          }
        }
      }, 35000); // 35 seconds - longer than reconnection grace period
      return;
    }

    io.to(room.id).emit("chat:message", {
      roomId: room.id,
      fromName: "System",
      text: `${leavingName} disconnected (can rejoin within 30 seconds)`,
      system: true,
    });

    if (connectedPlayers.length < 2) {
      room.phase = "lobby";
      room.word = null;
      broadcastRoomState(room);
      broadcastRoomsList();
      return;
    }

    if (leavingWasDrawer && room.phase === "drawing") {
      // End the round due to drawer disconnect
      endRound(room, "timeout");
    } else {
      // Just broadcast updated state
      broadcastRoomState(room);
      broadcastRoomsList();
    }
  });
});

// Determine port from environment or default to 3001
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Pictionary WebSocket server listening on port ${PORT}`);
});

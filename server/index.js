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
app.use(cors());

// Create an HTTP server
const httpServer = http.createServer(app);

// Create a Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// In-memory game state (ephemeral)
const players = new Map(); // socketId -> { name, score }
let currentDrawerId = null;
let currentPrompt = null;
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
];

const normalize = (str) =>
  String(str || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const choosePrompt = () => prompts[Math.floor(Math.random() * prompts.length)];

const getPlayerList = () =>
  Array.from(players.entries()).map(([id, p]) => ({
    id,
    name: p.name,
    score: p.score,
  }));

const broadcastState = () => {
  io.to("pictionary").emit("state", {
    players: getPlayerList(),
    currentDrawerId,
  });
};

const startNextRound = () => {
  const ids = Array.from(players.keys());
  if (ids.length < 2) {
    currentDrawerId = null;
    currentPrompt = null;
    io.to("pictionary").emit("waiting_for_players");
    broadcastState();
    return;
  }
  if (!currentDrawerId || !players.has(currentDrawerId)) {
    currentDrawerId = ids[0];
  } else {
    const idx = ids.indexOf(currentDrawerId);
    currentDrawerId = ids[(idx + 1) % ids.length];
  }
  currentPrompt = choosePrompt();
  // Clear canvas for everyone first
  io.to("pictionary").emit("clear");
  // Broadcast state with new drawer
  broadcastState();
  // Let everyone know a new round began
  io.to("pictionary").emit("round_started");
  // Notify new drawer privately with a small delay to ensure state is updated
  setTimeout(() => {
    io.to(currentDrawerId).emit("prompt", currentPrompt);
    console.log(`Sent prompt "${currentPrompt}" to drawer ${currentDrawerId}`);
  }, 100);
};

// Simple ping route to verify the server is up
app.get("/", (_req, res) => {
  res.send("Pictionary WebSocket server is running");
});

// Handle new client connections
io.on("connection", (socket) => {
  console.log("A client connected:", socket.id);

  // Join a room so that broadcasts go to all clients
  socket.join("pictionary");

  // Allow client to provide a display name
  socket.on("join", (displayName) => {
    const name =
      String(displayName || "").trim() || `Player ${socket.id.slice(0, 4)}`;
    if (!players.has(socket.id)) {
      players.set(socket.id, { name, score: 0 });
    } else {
      const existing = players.get(socket.id);
      players.set(socket.id, { ...existing, name });
    }
    // Start the first round only when at least two players are present
    if (!currentDrawerId && players.size >= 2) {
      startNextRound();
    } else {
      // Notify current drawer of prompt again in case a late joiner needs state
      if (currentDrawerId && currentPrompt) {
        io.to(currentDrawerId).emit("prompt", currentPrompt);
      }
      broadcastState();
    }
  });

  // Clients may request the latest state after (re)connect
  socket.on("request_state", () => {
    // Always provide current state snapshot first
    socket.emit("state", {
      players: getPlayerList(),
      currentDrawerId,
    });

    if (players.size < 2) {
      socket.emit("waiting_for_players");
    } else if (currentDrawerId && currentPrompt) {
      // Re-send the prompt to the drawer if they are the one requesting
      if (socket.id === currentDrawerId) {
        setTimeout(() => {
          socket.emit("prompt", currentPrompt);
          console.log(
            `Re-sent prompt "${currentPrompt}" to drawer ${socket.id}`
          );
        }, 100);
      }
    }
  });

  // When a client draws, broadcast the stroke to everyone else
  socket.on("drawing", (data) => {
    // Only the current drawer may draw
    if (socket.id !== currentDrawerId) {
      return;
    }
    // Broadcast to everyone except the sender
    socket.to("pictionary").emit("drawing", data);
  });

  // Chat messages (guesses) are broadcast to all
  socket.on("chat", (message) => {
    const text = String(message || "").trim();
    if (!text) return;

    // If a guess matches the prompt, award points and start next round
    if (
      currentPrompt &&
      socket.id !== currentDrawerId &&
      normalize(text) === normalize(currentPrompt)
    ) {
      const guesser = players.get(socket.id);
      const drawer = players.get(currentDrawerId || "");
      if (guesser) guesser.score += 1;
      if (drawer) drawer.score += 1;

      io.to("pictionary").emit("chat", {
        id: "system",
        message: `${
          guesser ? guesser.name : "Someone"
        } guessed it! The word was "${currentPrompt}".`,
      });
      broadcastState();
      startNextRound();
      return;
    }

    // Otherwise, broadcast the chat message
    io.to("pictionary").emit("chat", {
      id: socket.id,
      message: text,
    });
  });

  // Clear the canvas for everyone
  socket.on("clear", () => {
    // Only drawer can clear
    if (socket.id === currentDrawerId) {
      io.to("pictionary").emit("clear");
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    const removedWasDrawer = socket.id === currentDrawerId;
    players.delete(socket.id);
    if (players.size >= 2 && removedWasDrawer) {
      startNextRound();
    } else {
      // Not enough players; reset state if fewer than two
      if (players.size < 2) {
        currentDrawerId = null;
        currentPrompt = null;
      }
      broadcastState();
    }
  });
});

// Determine port from environment or default to 3001
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Pictionary WebSocket server listening on port ${PORT}`);
});

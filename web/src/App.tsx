import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type Point = { x: number; y: number };

type PlayerInfo = {
  id: string;
  name: string;
  score: number;
};

type RoomStateEvent = {
  roomId: string;
  players: PlayerInfo[];
  round: number;
  turnPlayerId: string | null;
  drawerId: string | null;
  phase: "lobby" | "drawing" | "intermission";
  timeLeft?: number;
};

type ChatEvent = {
  roomId: string;
  fromName: string;
  text: string;
  system?: boolean;
};

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("lobby-1");
  const roomIdRef = useRef("lobby-1");
  const [joined, setJoined] = useState(false);
  const [rooms, setRooms] = useState<
    { id: string; count: number; capacity: number }[]
  >([]);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [word, setWord] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "lobby" | "drawing" | "intermission" | "gameover"
  >("lobby");
  const [round, setRound] = useState<number>(1);
  const [timeLeft, setTimeLeft] = useState<number | undefined>(undefined);
  const [showWelcome, setShowWelcome] = useState(true);

  // Keep roomIdRef in sync with roomId state
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // route-like navigation for welcome vs living-room
  useEffect(() => {
    const syncFromPath = () => {
      setShowWelcome(window.location.pathname !== "/living-room");
    };
    syncFromPath();
    const onPop = () => syncFromPath();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const createRoomId = () => `room-${Math.random().toString(36).slice(2, 6)}`;
  const goLiving = () => {
    if (window.location.pathname !== "/living-room") {
      window.history.pushState({}, "", "/living-room");
    }
    setShowWelcome(false);
  };

  // While on living-room and not joined, periodically refresh rooms list
  useEffect(() => {
    if (showWelcome || joined) return;
    const socket = socketRef.current;
    const tick = () => {
      if (socket) {
        console.log("[web] Requesting rooms list");
        socket.emit("rooms:request");
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [showWelcome, joined]);

  // Initialize canvas size and context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        const newWidth = parent.clientWidth;
        const newHeight = parent.clientHeight;
        // Only resize if dimensions actually changed (to avoid clearing canvas)
        if (canvas.width !== newWidth || canvas.height !== newHeight) {
          // Save current canvas content before resizing
          const imageData = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height);

          canvas.width = newWidth;
          canvas.height = newHeight;

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.lineWidth = 4;

            // Restore canvas content after resize (if there was any)
            if (imageData && imageData.data.some((pixel) => pixel !== 0)) {
              ctx.putImageData(imageData, 0, 0);
            }
          }
        }
      }
    };
    // Delay to ensure parent is properly sized
    setTimeout(resizeCanvas, 100);
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  // Connect to WebSocket server
  useEffect(() => {
    const serverUrl =
      (import.meta as any).env.VITE_SERVER_URL || "http://localhost:3001";
    const socket = io(serverUrl);
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[web] Connected to server:", socket.id, serverUrl);
      setSocketId(socket.id);
    });

    console.log("[web] Subscribing to rooms");
    socket.emit("rooms:subscribe");
    socket.on("rooms:list", ({ rooms }) => {
      console.log("[web] Rooms list received:", rooms);
      setRooms(rooms);
    });
    socket.on("player:join:error", ({ message }) => {
      console.error("[web] Join error:", message);
      alert(message);
    });

    socket.on(
      "draw:stroke",
      ({ roomId: rid, points }: { roomId: string; points: Point[] }) => {
        if (rid !== roomIdRef.current) return;
        const canvas = canvasRef.current;
        if (!canvas || !points || points.length < 2) return;
        const [p0, p1] = points;
        const scale = (p: Point) => {
          const isNormalized = p.x <= 1 && p.y <= 1;
          return {
            x: isNormalized ? p.x * canvas.width : p.x,
            y: isNormalized ? p.y * canvas.height : p.y,
          };
        };
        const a = scale(p0);
        const b = scale(p1);
        drawLine(a.x, a.y, b.x, b.y, false);
      }
    );

    socket.on("round:clear", ({ roomId: rid }: { roomId: string }) => {
      if (rid !== roomIdRef.current) return;
      clearCanvas();
    });

    socket.on("chat:message", (evt: ChatEvent) => {
      if (evt.roomId !== roomIdRef.current) return;
      setMessages((prev) => [...prev, evt]);
    });

    socket.on("room:state", (state: RoomStateEvent) => {
      if (state.roomId !== roomIdRef.current) return;
      setPlayers(state.players);
      setDrawerId(state.drawerId);
      setPhase(state.phase);
      setRound(state.round);
      setTimeLeft(state.timeLeft);
      // Only resize canvas if size actually changed (to avoid clearing it)
      setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas && canvas.parentElement) {
          const newWidth = canvas.parentElement.clientWidth;
          const newHeight = canvas.parentElement.clientHeight;
          // Only resize if dimensions actually changed
          if (canvas.width !== newWidth || canvas.height !== newHeight) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            // Re-apply canvas settings after resize
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.lineWidth = 4;
            }
          }
        }
      }, 50);
    });

    socket.on("round:word", ({ word }: { word: string }) => {
      setWord(word);
    });

    socket.on(
      "game:over",
      ({
        winner,
        reason,
        finalScores,
      }: {
        winner: { id: string; name: string; score: number } | null;
        reason: string;
        finalScores: { id: string; name: string; score: number }[];
      }) => {
        setPhase("gameover");
        setMessages((prev) => [
          ...prev,
          {
            roomId: roomIdRef.current,
            fromName: "System",
            text: `🎉 Game Over! ${reason}`,
            system: true,
          },
        ]);
      }
    );

    socket.on(
      "score:update",
      ({ roomId: rid, players }: { roomId: string; players: PlayerInfo[] }) => {
        if (rid !== roomIdRef.current) return;
        setPlayers(players);
      }
    );

    socket.on(
      "round:ended",
      ({ roomId: rid, reason }: { roomId: string; reason: string }) => {
        if (rid !== roomIdRef.current) return;
        setWord(null);
        setMessages((prev) => [
          ...prev,
          {
            roomId,
            fromName: "System",
            text: `Round ended (${reason}).`,
            system: true,
          },
        ]);
      }
    );

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Remove roomId dependency - socket should only connect once

  const drawLine = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    emit: boolean
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#000000";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.closePath();
    if (!emit) return;
    if (socketRef.current) {
      const width = canvas.width;
      const height = canvas.height;
      const p0 = { x: x0 / width, y: y0 / height };
      const p1 = { x: x1 / width, y: y1 / height };
      socketRef.current.emit("draw:stroke", {
        roomId: roomIdRef.current,
        points: [p0, p1],
      });
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const isDrawer = socketId && drawerId && socketId === drawerId;
    if (!isDrawer) return;
    setIsDrawing(true);
    const rect = e.currentTarget.getBoundingClientRect();
    setLastPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (!isDrawing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (lastPos) {
      drawLine(lastPos.x, lastPos.y, x, y, true);
    }
    setLastPos({ x, y });
  };

  const endDrawing: React.MouseEventHandler<HTMLCanvasElement> = () => {
    if (isDrawing && socketRef.current) {
      // Send a stroke-end signal to indicate this stroke is complete
      const isDrawer = socketId && drawerId && socketId === drawerId;
      if (isDrawer) {
        socketRef.current.emit("draw:stroke", {
          roomId: roomIdRef.current,
          points: [], // Empty points array signals stroke end
        });
      }
    }
    setIsDrawing(false);
    setLastPos(null);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    const isDrawer = socketId && drawerId && socketId === drawerId;
    if (!socketRef.current) return;
    if (isDrawer) {
      socketRef.current.emit("chat:message", {
        roomId: roomIdRef.current,
        message: trimmed,
      });
    } else {
      socketRef.current.emit("guess:submit", {
        roomId: roomIdRef.current,
        guess: trimmed,
      });
    }
    setInput("");
  };

  const handleClear = () => {
    clearCanvas();
    const isDrawer = socketId && drawerId && socketId === drawerId;
    if (socketRef.current && isDrawer) {
      socketRef.current.emit("round:clear", { roomId: roomIdRef.current });
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socketRef.current) return;
    socketRef.current.emit("player:join", {
      roomId: roomId.trim() || "lobby-1",
      name: name.trim(),
    });
    setJoined(true);
  };

  if (showWelcome) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#f8f8f8",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 24,
            width: "92%",
            maxWidth: 760,
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>
            Welcome to Pictionary
          </h1>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            <div
              style={{
                border: "1px solid #e5e5ea",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <h3 style={{ marginTop: 0 }}>Rules of the game</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>Each round one player is the drawer.</li>
                <li>Guessers type their guesses in the input.</li>
                <li>First correct guesser: +2 points; drawer: +1 point.</li>
                <li>No points if time runs out or skipped.</li>
                <li>No self-guessing. First correct only counts.</li>
              </ul>
            </div>
            <div
              style={{
                border: "1px solid #e5e5ea",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <h3 style={{ marginTop: 0 }}>Getting started</h3>
              <p style={{ marginTop: 0, color: "#666" }}>
                Press Start to proceed to the living room, where you can enter
                your name, create a new room, or join an existing one.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={goLiving}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "#0a84ff",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  Start
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#f8f8f8",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 32,
            maxWidth: 400,
            width: "90%",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 24, marginBottom: 8 }}>Living Room</h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              textAlign: "left",
            }}
          >
            <label style={{ fontWeight: 600 }}>Your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid #c7c7cc",
                fontSize: 16,
                marginBottom: 8,
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <button
                onClick={() => {
                  const trimmedName = (name || "").trim();
                  if (!trimmedName) {
                    alert("Please enter your name before creating a room!");
                    return;
                  }

                  const id = createRoomId();
                  console.log(
                    `[web] Creating room: ${id} with name: ${trimmedName}`
                  );
                  setRoomId(id);
                  if (!socketRef.current) {
                    console.error("[web] Socket not initialized");
                    return;
                  }
                  if (!socketRef.current.connected) {
                    console.error("[web] Socket not connected");
                    return;
                  }
                  console.log(`[web] Emitting player:join for room ${id}`);
                  socketRef.current.emit("player:join", {
                    roomId: id,
                    name: trimmedName,
                  });
                  // Optimistically reflect my presence while waiting for server state
                  setPlayers([
                    { id: socketId || "me", name: trimmedName, score: 0 },
                  ]);
                  setPhase("lobby");
                  setRound(1);
                  setJoined(true);
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  background: "#34c759",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                Create New Room
              </button>
            </div>
            {rooms.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{ fontWeight: 600, display: "block", marginBottom: 6 }}
                >
                  Or enter Room ID to join:
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Enter room ID"
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: 10,
                      border: "1px solid #c7c7cc",
                      fontSize: 16,
                    }}
                  />
                  <button
                    onClick={() => {
                      const trimmedName = (name || "").trim();
                      if (!trimmedName) {
                        alert("Please enter your name before joining a room!");
                        return;
                      }

                      if (socketRef.current && roomId) {
                        console.log(
                          `[web] Joining room: ${roomId} with name: ${trimmedName}`
                        );
                        socketRef.current.emit("player:join", {
                          roomId: roomId.trim(),
                          name: trimmedName,
                        });
                        // Optimistic self in players until room:state arrives
                        setPlayers([
                          { id: socketId || "me", name: trimmedName, score: 0 },
                        ]);
                        setPhase("lobby");
                        setJoined(true);
                      }
                    }}
                    disabled={!roomId}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 10,
                      background: !roomId ? "#c7c7cc" : "#0a84ff",
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    Join Room
                  </button>
                </div>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Available Rooms
              </div>
              {rooms.length === 0 ? (
                <div style={{ color: "#666" }}>
                  There are no active rooms. Start a new one and invite your
                  friends to play.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        const trimmedName = (name || "").trim();
                        if (!trimmedName) {
                          alert(
                            "Please enter your name before joining a room!"
                          );
                          return;
                        }

                        setRoomId(r.id);
                        // Join the room directly
                        if (socketRef.current) {
                          console.log(
                            `[web] Joining room: ${r.id} with name: ${trimmedName}`
                          );
                          socketRef.current.emit("player:join", {
                            roomId: r.id,
                            name: trimmedName,
                          });
                          setPlayers([
                            {
                              id: socketId || "me",
                              name: trimmedName,
                              score: 0,
                            },
                          ]);
                          setPhase("lobby");
                          setJoined(true);
                        }
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #e5e5ea",
                        background: "#f2f2f7",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{r.id}</div>
                      <div style={{ color: "#666" }}>
                        {r.count}/{r.capacity} players
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "gameover") {
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    const winner = sortedPlayers[0];

    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#f8f8f8",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 32,
            maxWidth: 500,
            width: "90%",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 32, marginBottom: 16 }}>🎉 Game Over! 🎉</h1>
          <h2 style={{ fontSize: 24, marginBottom: 24, color: "#0a84ff" }}>
            {winner?.name} Wins!
          </h2>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Final Scores:</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedPlayers.map((p, idx) => (
                <div
                  key={p.id}
                  style={{
                    background: idx === 0 ? "#ffd700" : "#f2f2f7",
                    padding: "12px 16px",
                    borderRadius: 8,
                    display: "flex",
                    justifyContent: "space-between",
                    fontWeight: idx === 0 ? 700 : 400,
                  }}
                >
                  <span>
                    {idx === 0 ? "🏆 " : `${idx + 1}. `}
                    {p.name}
                  </span>
                  <span>{p.score} points</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => {
                if (socketRef.current) {
                  socketRef.current.emit("game:restart", {
                    roomId: roomIdRef.current,
                  });
                }
              }}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                background: "#34c759",
                color: "#fff",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              Play Again
            </button>
            <button
              onClick={() => {
                if (socketRef.current) {
                  socketRef.current.emit("player:leave", {
                    roomId: roomIdRef.current,
                  });
                }
                setJoined(false);
                setPlayers([]);
                setMessages([]);
                setWord(null);
                setPhase("lobby");
              }}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                background: "#ff3b30",
                color: "#fff",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              Leave Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "lobby" || players.length < 2) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#f8f8f8",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 32,
            maxWidth: 400,
            width: "90%",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 24, marginBottom: 8 }}>
            Waiting for players...
          </h2>
          <p style={{ color: "#666", marginBottom: 24 }}>
            {players.length}/2 players in room ({roomId})
          </p>
          <div style={{ marginBottom: 8, color: "#666" }}>Round: {round}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {players.map((p) => (
              <div
                key={p.id}
                style={{
                  background: "#f2f2f7",
                  padding: "8px 16px",
                  borderRadius: 8,
                  fontWeight: 600,
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#f8f8f8",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #e5e5ea",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {socketId && drawerId && socketId === drawerId
              ? "You are drawing"
              : "You are guessing"}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>Round: {round}</div>
            {typeof timeLeft === "number" && (
              <div
                style={{
                  padding: "4px 8px",
                  background: "#f2f2f7",
                  borderRadius: 8,
                }}
              >
                {phase === "drawing" ? "Time left" : "Next round in"}:{" "}
                {timeLeft}s
              </div>
            )}
          </div>
          <button
            onClick={() => {
              if (!socketRef.current) return;
              socketRef.current.emit("player:leave", {
                roomId: roomIdRef.current,
              });
              setJoined(false);
              setPlayers([]);
              setMessages([]);
              setWord(null);
              setPhase("lobby");
              socketRef.current.emit("rooms:request");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              background: "#ff3b30",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Exit Room
          </button>
          {socketId && drawerId && socketId === drawerId && word ? (
            <div style={{ fontWeight: 700, color: "#0a84ff" }}>
              Draw: {word}
            </div>
          ) : null}
        </div>
        {players.length > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 8,
              overflowX: "auto",
              paddingBottom: 6,
            }}
          >
            {players.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  border: "1px solid #e5e5ea",
                  background: p.id === drawerId ? "#d6e4ff" : "#f2f2f7",
                  borderRadius: 16,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {p.name}
                  {p.id === drawerId ? " ✏️" : ""}
                </span>
                <span style={{ fontVariant: "tabular-nums" }}>{p.score}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          position: "relative",
          margin: 12,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e5e5ea",
          background: "#fff",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", touchAction: "none" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={endDrawing}
          onMouseLeave={endDrawing}
        />
        <button
          onClick={handleClear}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#e5e5ea",
            fontWeight: 600,
          }}
          disabled={!(socketId && drawerId && socketId === drawerId)}
        >
          Clear
        </button>
      </div>
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid #e5e5ea",
          maxHeight: 180,
          overflowY: "auto",
          background: "#fff",
        }}
      >
        <div
          style={{ height: "60px", overflowY: "auto", marginBottom: "0.5rem" }}
        >
          {messages.map((msg, idx) => (
            <div key={idx} style={{ marginBottom: "0.3rem" }}>
              <strong>{msg.fromName}:</strong> {msg.text}
            </div>
          ))}
        </div>
        <form onSubmit={handleSendMessage} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              socketId && drawerId && socketId === drawerId
                ? "Type a chat message..."
                : "Type your guess..."
            }
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #c7c7cc",
              background: "#f2f2f7",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              background: "#0a84ff",
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {socketId && drawerId && socketId === drawerId ? "Chat" : "Guess"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;

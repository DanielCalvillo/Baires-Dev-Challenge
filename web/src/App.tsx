import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface DrawingData {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
}

interface ChatMessage {
  id: string;
  message: string;
}

interface PlayerInfo {
  id: string;
  name: string;
  score: number;
}

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [color] = useState<string>("#000000");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [currentDrawerId, setCurrentDrawerId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [waitingForPlayers, setWaitingForPlayers] = useState(false);

  // Initialize canvas size and context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 4;
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
      console.log("Connected with ID:", socket.id);
      setSocketId(socket.id);
      socket.emit("request_state");
    });

    socket.on(
      "drawing",
      (data: DrawingData & { width?: number; height?: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const wRemote = data.width || canvas.width;
        const hRemote = data.height || canvas.height;
        const scaleX = canvas.width / wRemote;
        const scaleY = canvas.height / hRemote;
        drawLine(
          data.x0 * scaleX,
          data.y0 * scaleY,
          data.x1 * scaleX,
          data.y1 * scaleY,
          data.color,
          false
        );
      }
    );

    socket.on("clear", () => {
      clearCanvas();
    });

    socket.on("chat", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on(
      "state",
      (state: { players: PlayerInfo[]; currentDrawerId: string | null }) => {
        console.log("State update:", {
          currentDrawerId: state.currentDrawerId,
          myId: socket.id,
        });
        setPlayers(state.players);
        setCurrentDrawerId(state.currentDrawerId);
      }
    );
    socket.on("prompt", (p: string) => {
      console.log("Received prompt:", p);
      setPrompt(p);
    });
    socket.on("waiting_for_players", () => {
      setPrompt(null);
      setCurrentDrawerId(null);
      setWaitingForPlayers(true);
    });

    socket.on("round_started", () => {
      setWaitingForPlayers(false);
      // Don't clear prompt here, it will be set for drawer
      // Resize canvas after DOM updates
      setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas && canvas.parentElement) {
          canvas.width = canvas.parentElement.clientWidth;
          canvas.height = canvas.parentElement.clientHeight;
        }
      }, 100);
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawLine = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    strokeColor: string,
    emit: boolean
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = strokeColor;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.closePath();
    if (!emit) return;
    if (socketRef.current) {
      const width = canvas.width;
      const height = canvas.height;
      socketRef.current.emit("drawing", {
        x0,
        y0,
        x1,
        y1,
        color: strokeColor,
        width,
        height,
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
    // Only allow drawing if you are the drawer
    if (!socketId || !currentDrawerId || socketId !== currentDrawerId) {
      console.log("Not drawer - cannot draw", { socketId, currentDrawerId });
      return;
    }
    console.log("Starting to draw as drawer");
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
      drawLine(lastPos.x, lastPos.y, x, y, color, true);
    }
    setLastPos({ x, y });
  };

  const endDrawing: React.MouseEventHandler<HTMLCanvasElement> = () => {
    setIsDrawing(false);
    setLastPos(null);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    if (socketRef.current) {
      socketRef.current.emit("chat", trimmed);
    }
    setInput("");
  };

  const handleClear = () => {
    clearCanvas();
    if (
      socketRef.current &&
      socketId &&
      currentDrawerId &&
      socketId === currentDrawerId
    ) {
      socketRef.current.emit("clear");
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socketRef.current) return;
    socketRef.current.emit("join", name.trim());
    setJoined(true);
  };

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
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>
            Welcome to Pictionary!
          </h1>
          <p style={{ color: "#666", marginBottom: 24 }}>
            Enter your name to join
          </p>
          <form
            onSubmit={handleJoin}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid #c7c7cc",
                fontSize: 16,
              }}
              autoFocus
            />
            <button
              type="submit"
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                background: "#0a84ff",
                color: "#fff",
                fontWeight: 700,
                fontSize: 16,
                border: "none",
                cursor: "pointer",
              }}
            >
              Join Game
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (waitingForPlayers || players.length < 2) {
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
            {players.length}/2 players in room
          </p>
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
            {socketId && currentDrawerId && socketId === currentDrawerId
              ? "You are drawing"
              : "You are guessing"}
          </div>
          {socketId &&
          currentDrawerId &&
          socketId === currentDrawerId &&
          prompt ? (
            <div style={{ fontWeight: 700, color: "#0a84ff" }}>
              Draw: {prompt}
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
                  background: p.id === currentDrawerId ? "#d6e4ff" : "#f2f2f7",
                  borderRadius: 16,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {p.name}
                  {p.id === currentDrawerId ? " ✏️" : ""}
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
          disabled={
            !(socketId && currentDrawerId && socketId === currentDrawerId)
          }
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
              <strong>{msg.id.slice(0, 4)}:</strong> {msg.message}
            </div>
          ))}
        </div>
        <form onSubmit={handleSendMessage} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your guess..."
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
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

export default App;

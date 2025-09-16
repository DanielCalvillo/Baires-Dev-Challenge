import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  PanResponder,
  Dimensions,
  TextInput,
  ScrollView,
  Text,
  Platform,
  KeyboardAvoidingView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { io, Socket } from "socket.io-client";
import Constants from "expo-constants";

interface DrawingEvent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width?: number;
  height?: number;
}

type ChatEvent = {
  roomId: string;
  fromName: string;
  text: string;
  system?: boolean;
};

interface Point {
  x: number;
  y: number;
}

interface Line {
  points: Point[];
  color: string;
}

const PictionaryApp: React.FC = () => {
  const [lines, setLines] = useState<Line[]>([]);
  const [currentLine, setCurrentLine] = useState<Line | null>(null);
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [roomId, setRoomId] = useState("lobby-1");
  const roomIdRef = useRef("lobby-1");
  const [rooms, setRooms] = useState<{ id: string; count: number; capacity: number }[]>([]);
  const [joined, setJoined] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [players, setPlayers] = useState<
    { id: string; name: string; score: number }[]
  >([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [word, setWord] = useState<string | null>(null);
  const [phase, setPhase] = useState<"lobby" | "drawing" | "intermission" | "gameover">("lobby");
  const [round, setRound] = useState<number>(1);
  const [timeLeft, setTimeLeft] = useState<number | undefined>(undefined);
  const [showWelcome, setShowWelcome] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const drawerIdRef = useRef<string | null>(null);
  const socketIdRef = useRef<string | null>(null);
  const isReceivingStroke = useRef(false);
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const strokeColor = "#000000";

  // Keep roomIdRef in sync with roomId state
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    const hostFromExpo = (Constants.expoConfig?.hostUri || "").split(":")[0];
    const envUrl =
      process.env.EXPO_PUBLIC_SERVER_URL ||
      process.env.SERVER_URL ||
      Constants.expoConfig?.extra?.SERVER_URL;

    const isLocalhost = (url?: string) =>
      !!url && /(^|\/)localhost(?=[:/]|$)|127\.0\.0\.1/.test(url);

    const deriveServerUrl = (): string => {
      if (envUrl && !isLocalhost(envUrl)) return envUrl;
      if (hostFromExpo && !isLocalhost(hostFromExpo))
        return `http://${hostFromExpo}:3001`;
      if (Platform.OS === "android") return "http://10.0.2.2:3001";
      return envUrl || "http://localhost:3001";
    };

    const serverUrl = deriveServerUrl();
    const socket = io(serverUrl, {
      transports: ["websocket"],
    });
    socketRef.current = socket;

    // Log connection lifecycle to aid debugging on devices/emulators
    socket.on("connect", () => {
      console.log("[socket] connected", { id: socket.id, url: serverUrl });
      setSocketId(socket.id);
      socketIdRef.current = socket.id;
    });
    socket.on("connect_error", (err) => {
      console.log("[socket] connect_error", err?.message);
    });
    socket.io.on("reconnect_attempt", (attempt) => {
      console.log("[socket] reconnect_attempt", attempt);
    });

    socket.emit("rooms:subscribe");
    socket.on("rooms:list", ({ rooms }) => {
      console.log("[socket] rooms:list received:", rooms);
      setRooms(rooms);
    });
    socket.on("player:join:error", ({ message }) => {
      console.log("join error:", message);
    });

    socket.on("draw:stroke", ({ roomId: rid, points }: { roomId: string; points: Point[] }) => {
      if (rid !== roomIdRef.current) return;
      
      // Empty points array signals end of stroke
      if (!points || points.length === 0) {
        isReceivingStroke.current = false;
        return;
      }
      
      if (points.length < 2) return;
      const [p0, p1] = points;
      const scalePoint = (p: Point) => ({ x: p.x * screenWidth, y: p.y * (screenHeight - 380) });
      const a = scalePoint(p0);
      const b = scalePoint(p1);
      
      setLines((prev) => {
        // If we're continuing a stroke, append to the last line
        if (isReceivingStroke.current && prev.length > 0) {
          const last = prev[prev.length - 1];
          return [
            ...prev.slice(0, prev.length - 1),
            { ...last, points: [...last.points, b] },
          ];
        } else {
          // Starting a new stroke
          isReceivingStroke.current = true;
          return [
            ...prev,
            { points: [a, b], color: strokeColor },
          ];
        }
      });
    });

    socket.on("round:clear", ({ roomId: rid }: { roomId: string }) => {
      if (rid !== roomIdRef.current) return;
      setLines([]);
    });

    socket.on("chat:message", (evt: ChatEvent) => {
      if (evt.roomId !== roomIdRef.current) return;
      setMessages((prev) => [...prev, evt]);
    });

    socket.on("room:state", (state: { roomId: string; players: { id: string; name: string; score: number }[]; drawerId: string | null; phase: "lobby"|"drawing"|"intermission"; round: number; turnPlayerId: string | null; timeLeft?: number; }) => {
      if (state.roomId !== roomIdRef.current) return;
      setPlayers(state.players);
      setDrawerId(state.drawerId);
      drawerIdRef.current = state.drawerId;
      setPhase(state.phase);
      setRound(state.round);
      setTimeLeft(state.timeLeft);
    });

    socket.on("round:word", ({ word }: { word: string }) => {
      setWord(word);
    });

    socket.on("game:over", ({ winner, reason, finalScores }: { 
      winner: { id: string; name: string; score: number } | null;
      reason: string;
      finalScores: { id: string; name: string; score: number }[];
    }) => {
      setPhase("gameover");
      setMessages((prev) => [
        ...prev,
        { roomId: roomIdRef.current, fromName: "System", text: `🎉 Game Over! ${reason}`, system: true },
      ]);
    });

    socket.on("round:ended", ({ roomId: rid, reason }: { roomId: string; reason: string }) => {
      if (rid !== roomIdRef.current) return;
      setWord(null);
      setMessages((prev) => [
        ...prev,
        { roomId, fromName: "System", text: `Round ended (${reason}).`, system: true },
      ]);
    });

    socket.on("score:update", ({ roomId: rid, players }: { roomId: string; players: { id: string; name: string; score: number }[] }) => {
      if (rid !== roomIdRef.current) return;
      setPlayers(players);
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Remove roomId dependency - socket should only connect once

  // Refresh rooms list periodically on living room (not joined)
  useEffect(() => {
    if (showWelcome || joined) return;
    const s = socketRef.current;
    const tick = () => s && s.emit("rooms:request");
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [showWelcome, joined]);

  // Create PanResponder with dependencies
  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, _gestureState) => {
        const isCurrentDrawer = socketId && drawerId && socketId === drawerId;
        if (!isCurrentDrawer) {
          console.log('Not drawer - cannot draw', { socketId, drawerId });
          return;
        }
        const { locationX, locationY } = evt.nativeEvent;
        const line: Line = {
          points: [{ x: locationX, y: locationY }],
          color: strokeColor,
        };
        setCurrentLine(line);
      },
      onPanResponderMove: (evt, _gestureState) => {
        const isCurrentDrawer = socketIdRef.current && drawerIdRef.current && socketIdRef.current === drawerIdRef.current;
        if (!isCurrentDrawer) return;
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentLine((prev) => {
          if (!prev) return prev;
          const newPoint = { x: locationX, y: locationY };
          // emit drawing event for the last segment
          if (prev.points.length > 0 && socketRef.current) {
            const lastPoint = prev.points[prev.points.length - 1];
            const p0 = { x: lastPoint.x / screenWidth, y: lastPoint.y / (screenHeight - 380) };
            const p1 = { x: newPoint.x / screenWidth, y: newPoint.y / (screenHeight - 380) };
            socketRef.current.emit("draw:stroke", { roomId: roomIdRef.current, points: [p0, p1] });
          }
          return { ...prev, points: [...prev.points, newPoint] };
        });
      },
      onPanResponderRelease: () => {
        const isCurrentDrawer = socketIdRef.current && drawerIdRef.current && socketIdRef.current === drawerIdRef.current;
        if (!isCurrentDrawer) return;
        
        // Send stroke-end signal
        if (socketRef.current) {
          socketRef.current.emit("draw:stroke", { roomId: roomIdRef.current, points: [] });
        }
        
        setCurrentLine((line) => {
          if (line) {
            setLines((prev) => [...prev, line]);
          }
          return null;
        });
      },
      onPanResponderTerminate: () => {
        const isCurrentDrawer = socketIdRef.current && drawerIdRef.current && socketIdRef.current === drawerIdRef.current;
        if (!isCurrentDrawer) return;
        
        // Send stroke-end signal
        if (socketRef.current) {
          socketRef.current.emit("draw:stroke", { roomId: roomIdRef.current, points: [] });
        }
        
        setCurrentLine((line) => {
          if (line) {
            setLines((prev) => [...prev, line]);
          }
          return null;
        });
      },
    }),
    [socketId, drawerId] // Recreate when these change
  );

  // Convert a line's points to an SVG path string
  const lineToPath = (points: Point[]) => {
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
      .join(" ");
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (socketRef.current) {
      const isDrawer = socketId && drawerId && socketId === drawerId;
      if (isDrawer) {
        socketRef.current.emit("chat:message", { roomId: roomIdRef.current, message: trimmed });
      } else {
        socketRef.current.emit("guess:submit", { roomId: roomIdRef.current, guess: trimmed });
      }
    }
    setInput("");
  };

  const handleClear = () => {
    const isCurrentDrawer = socketId && drawerId && socketId === drawerId;
    setLines([]);
    if (socketRef.current && isCurrentDrawer) {
      socketRef.current.emit("round:clear", { roomId: roomIdRef.current });
    }
  };

  const handleJoin = (customRoomId?: string) => {
    const name = playerName.trim();
    if (!name) {
      Alert.alert("Name Required", "Please enter your name before joining a room!");
      return;
    }
    
    const targetRoomId = customRoomId || roomIdRef.current.trim() || "lobby-1";
    console.log(`[mobile] Joining room: ${targetRoomId} with name: ${name}`);
    if (!socketRef.current) return;
    socketRef.current.emit("player:join", { roomId: targetRoomId, name });
    // Optimistically reflect my presence in waiting screen until room:state arrives
    setPlayers([{ id: socketId || "me", name, score: 0 }]);
    setPhase("lobby");
    setRound(1);
    setJoined(true);
  };

  const handleLeave = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("player:leave", { roomId: roomIdRef.current });
    setJoined(false);
    setPlayers([]);
    setMessages([]);
    setWord(null);
    setPhase("lobby");
    socketRef.current.emit("rooms:request");
  };

  const handleSkip = () => {
    if (!socketRef.current) return;
    if (!(socketId && drawerId && socketId === drawerId)) return;
    socketRef.current.emit("round:skip", { roomId });
  };

  if (showWelcome) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView style={styles.container}>
          <View style={styles.centerContainer}>
            <View style={[styles.joinCard, { maxWidth: 500 }] }>
              <Text style={styles.welcomeTitle}>Welcome to Pictionary</Text>
              <Text style={styles.welcomeSubtitle}>Rules of the game</Text>
              <View style={{ width: "100%", borderWidth: 1, borderColor: "#e5e5ea", borderRadius: 12, padding: 16 }}>
                <Text>- One player draws each round.</Text>
                <Text>- Guessers type their guesses.</Text>
                <Text>- First correct: +2 points; drawer: +1 point.</Text>
                <Text>- No points if time runs out or skipped.</Text>
                <Text>- No self-guessing. First correct only counts.</Text>
              </View>
              <TouchableOpacity style={[styles.primaryButton, { marginTop: 16 }]} onPress={() => setShowWelcome(false)}>
                <Text style={styles.primaryButtonText}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.container}>
        {!joined ? (
          <View style={styles.centerContainer}>
            <View style={[styles.joinCard, { maxWidth: 500 }]}>
              <Text style={styles.welcomeTitle}>Living Room</Text>
              <Text style={{ color: "#666", marginBottom: 8 }}>Enter your name, then create or join a room.</Text>
              <TextInput style={[styles.nameInput, { marginBottom: 12 }]} value={playerName} onChangeText={setPlayerName} placeholder="Your name" placeholderTextColor="#888" />
              <View style={{ width: "100%", flexDirection: "row", gap: 10, marginBottom: 12 }}>
                <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} onPress={() => { 
                  const name = playerName.trim();
                  if (!name) {
                    Alert.alert("Name Required", "Please enter your name before creating a room!");
                    return;
                  }
                  
                  const id = `room-${Math.random().toString(36).slice(2,6)}`; 
                  setRoomId(id); 
                  console.log(`[mobile] Creating new room: ${id} with name: ${name}`);
                  if (!socketRef.current) {
                    console.error("[mobile] Socket not initialized");
                    return;
                  }
                  if (!socketRef.current.connected) {
                    console.error("[mobile] Socket not connected");
                    return;
                  }
                  console.log(`[mobile] Emitting player:join for room ${id}`);
                  socketRef.current.emit("player:join", { roomId: id, name });
                  // Optimistically reflect my presence in waiting screen until room:state arrives
                  setPlayers([{ id: socketId || "me", name, score: 0 }]);
                  setPhase("lobby");
                  setRound(1);
                  setJoined(true);
                }}>
                  <Text style={styles.primaryButtonText}>Create New Room</Text>
                </TouchableOpacity>
              </View>
              {rooms.length > 0 && (
                <View style={{ width: "100%", marginBottom: 12 }}>
                  <Text style={{ fontWeight: "600", marginBottom: 6 }}>Or enter Room ID to join:</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput 
                      style={[styles.nameInput, { flex: 1, marginBottom: 0 }]} 
                      value={roomId} 
                      onChangeText={setRoomId} 
                      placeholder="Enter room ID" 
                      placeholderTextColor="#888" 
                    />
                    <TouchableOpacity 
                      style={[styles.primaryButton, { backgroundColor: !roomId ? "#c7c7cc" : "#0a84ff" }]} 
                      disabled={!roomId}
                      onPress={() => handleJoin()}
                    >
                      <Text style={styles.primaryButtonText}>Join</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              <View style={{ width: "100%" }}>
                <Text style={{ fontWeight: "700", marginBottom: 8 }}>Available Rooms</Text>
                {rooms.length === 0 ? (
                  <Text style={{ color: "#666" }}>There are no active rooms. Start a new one and invite your friends to play.</Text>
                ) : (
                  <ScrollView style={{ maxHeight: 200 }}>
                    {rooms.map((r) => (
                      <TouchableOpacity 
                        key={r.id} 
                        onPress={() => {
                          setRoomId(r.id);
                          handleJoin(r.id);
                        }} 
                        style={{ 
                          paddingVertical: 12, 
                          paddingHorizontal: 14, 
                          borderWidth: 1, 
                          borderColor: "#e5e5ea", 
                          backgroundColor: "#f2f2f7", 
                          borderRadius: 10, 
                          marginBottom: 8 
                        }}
                      >
                        <Text style={{ fontWeight: "600" }}>{r.id}</Text>
                        <Text style={{ color: "#666" }}>{r.count}/{r.capacity} players</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            </View>
          </View>
        ) : phase === "gameover" ? (
          <View style={styles.centerContainer}>
            <View style={styles.waitingCard}>
              <Text style={[styles.welcomeTitle, { fontSize: 28, marginBottom: 12 }]}>🎉 Game Over! 🎉</Text>
              <Text style={[styles.welcomeTitle, { fontSize: 20, color: "#0a84ff", marginBottom: 20 }]}>
                {[...players].sort((a, b) => b.score - a.score)[0]?.name} Wins!
              </Text>
              <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 12 }}>Final Scores:</Text>
              <View style={{ width: "100%", marginBottom: 20 }}>
                {[...players].sort((a, b) => b.score - a.score).map((p, idx) => (
                  <View
                    key={p.id}
                    style={{
                      backgroundColor: idx === 0 ? "#ffd700" : "#f2f2f7",
                      padding: 12,
                      marginVertical: 4,
                      borderRadius: 8,
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ fontWeight: idx === 0 ? "700" : "400" }}>
                      {idx === 0 ? "🏆 " : `${idx + 1}. `}{p.name}
                    </Text>
                    <Text style={{ fontWeight: idx === 0 ? "700" : "400" }}>{p.score} points</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity
                  style={[styles.primaryButton, { flex: 1, backgroundColor: "#34c759" }]}
                  onPress={() => {
                    if (socketRef.current) {
                      socketRef.current.emit("game:restart", { roomId: roomIdRef.current });
                    }
                  }}
                >
                  <Text style={styles.primaryButtonText}>Play Again</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, { flex: 1, backgroundColor: "#ff3b30" }]}
                  onPress={handleLeave}
                >
                  <Text style={styles.primaryButtonText}>Leave Room</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : phase === "lobby" || players.length < 2 ? (
          <View style={styles.centerContainer}>
            <View style={[styles.waitingCard, { paddingBottom: 28 }] }>
              <Text style={styles.waitingTitle}>Waiting for players...</Text>
              <Text style={styles.waitingSubtitle}>
                {players.length}/2 players in room ({roomId})
              </Text>
              <Text style={{ marginBottom: 8, color: "#666" }}>Round: {round}</Text>
              <View style={{ width: "100%", marginTop: 8, gap: 12 }}>
                {players.map((p) => (
                  <View key={p.id} style={[styles.waitingPlayer, { marginTop: 12 }]}>
                    <Text style={styles.waitingPlayerName}>{p.name}</Text>
                  </View>
                ))}
              </View>
              {rooms.length > 0 && (
                <View style={{ width: "100%", marginTop: 20 }}>
                  <Text style={{ fontWeight: "700", marginBottom: 8 }}>Available Rooms</Text>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {rooms.map((r) => (
                      <TouchableOpacity
                        key={r.id}
                        onPress={() => setRoomId(r.id)}
                        style={{
                          paddingVertical: 12,
                          paddingHorizontal: 14,
                          borderWidth: 1,
                          borderColor: "#e5e5ea",
                          backgroundColor: r.id === roomId ? "#e6f0ff" : "#f2f2f7",
                          borderRadius: 10,
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontWeight: "600" }}>{r.id}</Text>
                        <Text style={{ color: "#666" }}>{r.count}/{r.capacity} players</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.header}>
            <View style={styles.roleRow}>
              <Text style={styles.roleText}>
                {socketId && drawerId && socketId === drawerId ? "You are drawing" : "You are guessing"}
              </Text>
              {socketId && drawerId && socketId === drawerId && word ? (
                <Text style={styles.promptText}>Draw: {word}</Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
              <Text style={{ fontWeight: "600" }}>Round: {round}</Text>
              {typeof timeLeft === "number" && (
                <Text style={{ paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#f2f2f7", borderRadius: 8 }}>
                  {phase === "drawing" ? "Time left" : "Next round in"}: {timeLeft}s
                </Text>
              )}
              <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: "#ff3b30" }]} onPress={handleLeave}>
                <Text style={[styles.secondaryButtonText, { color: "#fff" }]}>Exit Room</Text>
              </TouchableOpacity>
            </View>
          )}
          {players.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 6 }}
            >
              {players.map((p) => (
                <View
                  key={p.id}
                  style={[
                    styles.playerPill,
                    p.id === drawerId && styles.playerPillActive,
                  ]}
                >
                  <Text style={styles.playerName}>
                    {p.name}
                    {p.id === drawerId ? " ✏️" : ""}
                  </Text>
                  <Text style={styles.playerScore}>{p.score}</Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>

            <View style={styles.canvasContainer} {...panResponder.panHandlers}>
              <Svg width={screenWidth} height={screenHeight - 380}>
            {lines.map((line, idx) => (
              <Path
                key={idx}
                d={lineToPath(line.points)}
                stroke={line.color}
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {currentLine && (
              <Path
                d={lineToPath(currentLine.points)}
                stroke={currentLine.color}
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </Svg>
          <View style={styles.clearButtonContainer}>
            <TouchableOpacity
              onPress={handleClear}
              disabled={!(socketId && drawerId && socketId === drawerId)}
              style={[styles.secondaryButton, !(socketId && drawerId && socketId === drawerId) && { opacity: 0.5 }]}
            >
              <Text style={styles.secondaryButtonText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSkip}
              disabled={!(socketId && drawerId && socketId === drawerId)}
              style={[styles.secondaryButton, { marginTop: 8, backgroundColor: "#ffd60a" }, !(socketId && drawerId && socketId === drawerId) && { opacity: 0.5 }]}
            >
              <Text style={[styles.secondaryButtonText, { color: "#111" }]}>Skip</Text>
            </TouchableOpacity>
          </View>
            </View>
            <View style={styles.chatContainer}>
          <ScrollView
            style={styles.messages}
            contentContainerStyle={{ paddingBottom: 4 }}
          >
            {messages.map((msg, idx) => (
              <Text key={idx} style={{ marginBottom: 4 }}>
                <Text style={{ fontWeight: "bold" }}>{msg.fromName}: </Text>
                {msg.text}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={socketId && drawerId && socketId === drawerId ? "Type a chat message..." : "Type your guess..."}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleSend}>
              <Text style={styles.primaryButtonText}>{socketId && drawerId && socketId === drawerId ? "Chat" : "Guess"}</Text>
            </TouchableOpacity>
          </View>
            </View>
          </>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: "#f8f8f8",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#e5e5ea",
  },
  joinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  nameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#c7c7cc",
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    fontSize: 18,
    color: "#000",
    minHeight: 50,
  },
  roleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  roleText: {
    fontSize: 16,
    fontWeight: "600",
  },
  promptText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0a84ff",
  },
  canvasContainer: {
    flex: 1,
    backgroundColor: "#fff",
    margin: 12,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  clearButtonContainer: {
    position: "absolute",
    top: 10,
    right: 10,
  },
  chatContainer: {
    borderTopWidth: 1,
    borderColor: "#e5e5ea",
    paddingHorizontal: 12,
    paddingVertical: 10,
    height: 180,
    backgroundColor: "#fff",
  },
  messages: {
    flex: 1,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#c7c7cc",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginRight: 0,
    backgroundColor: "#f2f2f7",
  },
  primaryButton: {
    backgroundColor: "#0a84ff",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "#e5e5ea",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#111",
    fontWeight: "600",
    fontSize: 16,
  },
  playerPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#f2f2f7",
    borderRadius: 16,
    marginRight: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: "#e5e5ea",
  },
  playerPillActive: {
    backgroundColor: "#d6e4ff",
    borderColor: "#0a84ff",
  },
  playerName: {
    fontWeight: "600",
  },
  playerScore: {
    fontVariant: ["tabular-nums"],
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  joinCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 12,
  },
  waitingCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 320,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  waitingTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  waitingSubtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
  },
  waitingPlayer: {
    backgroundColor: "#f2f2f7",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    minWidth: 200,
    alignItems: "center",
  },
  waitingPlayerName: {
    fontSize: 16,
    fontWeight: "600",
  },
});

export default PictionaryApp;

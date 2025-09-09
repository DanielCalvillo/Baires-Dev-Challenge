import React, { useEffect, useRef, useState } from "react";
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

interface ChatMessage {
  id: string;
  message: string;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [joined, setJoined] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [players, setPlayers] = useState<
    { id: string; name: string; score: number }[]
  >([]);
  const [currentDrawerId, setCurrentDrawerId] = useState<string | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);
  const [waitingForPlayers, setWaitingForPlayers] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const drawerIdRef = useRef<string | null>(null);
  const socketIdRef = useRef<string | null>(null);
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const strokeColor = "#000000";

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
      socket.emit("request_state");
    });
    socket.on("connect_error", (err) => {
      console.log("[socket] connect_error", err?.message);
    });
    socket.io.on("reconnect_attempt", (attempt) => {
      console.log("[socket] reconnect_attempt", attempt);
    });

    socket.on("drawing", (data: DrawingEvent) => {
      // scale coordinates from sender's canvas to our screen dimensions
      const wRemote = data.width || screenWidth;
      const hRemote = data.height || screenHeight;
      const scaleX = screenWidth / wRemote;
      const scaleY = (screenHeight - 380) / hRemote; // reserve space for header and chat UI
      const x0 = data.x0 * scaleX;
      const y0 = data.y0 * scaleY;
      const x1 = data.x1 * scaleX;
      const y1 = data.y1 * scaleY;
      // Append a new line segment to lines array
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.color === data.color) {
          // extend the last line
          return [
            ...prev.slice(0, prev.length - 1),
            { ...last, points: [...last.points, { x: x1, y: y1 }] },
          ];
        }
        // start a new line
        return [
          ...prev,
          {
            points: [
              { x: x0, y: y0 },
              { x: x1, y: y1 },
            ],
            color: data.color,
          },
        ];
      });
    });

    socket.on("clear", () => {
      setLines([]);
    });

    socket.on("chat", (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on(
      "state",
      (state: {
        players: { id: string; name: string; score: number }[];
        currentDrawerId: string | null;
      }) => {
        console.log("[socket] state update:", { currentDrawerId: state.currentDrawerId, myId: socketIdRef.current });
        setPlayers(state.players);
        setCurrentDrawerId(state.currentDrawerId);
        drawerIdRef.current = state.currentDrawerId;
      }
    );

    socket.on("prompt", (prompt: string) => {
      console.log("[socket] received prompt:", prompt);
      setCurrentPrompt(prompt);
    });

    socket.on("waiting_for_players", () => {
      setCurrentPrompt(null);
      setCurrentDrawerId(null);
      setWaitingForPlayers(true);
    });

    socket.on("round_started", () => {
      setWaitingForPlayers(false);
      // Don't clear prompt here, it will be set for drawer
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create PanResponder with dependencies
  const panResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, _gestureState) => {
        const isCurrentDrawer = socketId && currentDrawerId && socketId === currentDrawerId;
        if (!isCurrentDrawer) {
          console.log('Not drawer - cannot draw', { socketId, currentDrawerId });
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
            socketRef.current.emit("drawing", {
              x0: lastPoint.x,
              y0: lastPoint.y,
              x1: newPoint.x,
              y1: newPoint.y,
              color: prev.color,
              width: screenWidth,
              height: screenHeight - 380,
            });
          }
          return { ...prev, points: [...prev.points, newPoint] };
        });
      },
      onPanResponderRelease: () => {
        const isCurrentDrawer = socketIdRef.current && drawerIdRef.current && socketIdRef.current === drawerIdRef.current;
        if (!isCurrentDrawer) return;
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
        setCurrentLine((line) => {
          if (line) {
            setLines((prev) => [...prev, line]);
          }
          return null;
        });
      },
    }),
    [socketId, currentDrawerId] // Recreate when these change
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
      socketRef.current.emit("chat", trimmed);
    }
    setInput("");
  };

  const handleClear = () => {
    const isCurrentDrawer = socketId && currentDrawerId && socketId === currentDrawerId;
    setLines([]);
    if (socketRef.current && isCurrentDrawer) {
      socketRef.current.emit("clear");
    }
  };

  const handleJoin = () => {
    const name = playerName.trim();
    if (!socketRef.current) return;
    socketRef.current.emit("join", name);
    setJoined(true);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaView style={styles.container}>
        {!joined ? (
          <View style={styles.centerContainer}>
            <View style={styles.joinCard}>
              <Text style={styles.welcomeTitle}>Welcome to Pictionary!</Text>
              <Text style={styles.welcomeSubtitle}>Enter your name to join</Text>
              <TextInput
                style={styles.nameInput}
                value={playerName}
                onChangeText={setPlayerName}
                placeholder="Your name"
                placeholderTextColor="#888"
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleJoin}
              >
                <Text style={styles.primaryButtonText}>Join Game</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : waitingForPlayers || players.length < 2 ? (
          <View style={styles.centerContainer}>
            <View style={styles.waitingCard}>
              <Text style={styles.waitingTitle}>Waiting for players...</Text>
              <Text style={styles.waitingSubtitle}>
                {players.length}/2 players in room
              </Text>
              {players.map((p) => (
                <View key={p.id} style={styles.waitingPlayer}>
                  <Text style={styles.waitingPlayerName}>{p.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.header}>
            <View style={styles.roleRow}>
              <Text style={styles.roleText}>
                {socketId && currentDrawerId && socketId === currentDrawerId ? "You are drawing" : "You are guessing"}
              </Text>
              {socketId && currentDrawerId && socketId === currentDrawerId && currentPrompt ? (
                <Text style={styles.promptText}>Draw: {currentPrompt}</Text>
              ) : null}
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
                    p.id === currentDrawerId && styles.playerPillActive,
                  ]}
                >
                  <Text style={styles.playerName}>
                    {p.name}
                    {p.id === currentDrawerId ? " ✏️" : ""}
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
              disabled={!(socketId && currentDrawerId && socketId === currentDrawerId)}
              style={[styles.secondaryButton, !(socketId && currentDrawerId && socketId === currentDrawerId) && { opacity: 0.5 }]}
            >
              <Text style={styles.secondaryButtonText}>Clear</Text>
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
                <Text style={{ fontWeight: "bold" }}>
                  {msg.id.slice(0, 4)}:{" "}
                </Text>
                {msg.message}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Type your guess..."
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleSend}>
              <Text style={styles.primaryButtonText}>Send</Text>
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
    marginBottom: 24,
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
    marginBottom: 20,
  },
  waitingPlayer: {
    backgroundColor: "#f2f2f7",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    minWidth: 150,
    alignItems: "center",
  },
  waitingPlayerName: {
    fontSize: 16,
    fontWeight: "600",
  },
});

export default PictionaryApp;

# 🎨 Pictionary Game - Real-time Multiplayer Drawing & Guessing

A real-time multiplayer Pictionary game with cross-platform support for web and mobile. Draw, guess, and compete with friends in this classic party game brought to the digital world!

![Node.js](https://img.shields.io/badge/Node.js-v18+-green)
![React](https://img.shields.io/badge/React-v19-blue)
![React Native](https://img.shields.io/badge/React_Native-Expo_SDK_53-purple)
![Socket.io](https://img.shields.io/badge/Socket.io-v4.6-black)
![TypeScript](https://img.shields.io/badge/TypeScript-v5-blue)

## ✨ Features

- 🎮 **Real-time Multiplayer**: Play with friends instantly
- 🖌️ **Live Drawing**: See drawings appear in real-time as they're created
- 💬 **Chat & Guessing**: Communicate and submit guesses through integrated chat
- 📱 **Cross-Platform**: Works on web browsers and mobile devices (iOS/Android)
- 🏆 **Score Tracking**: Automatic scoring for correct guesses
- 🔄 **Turn-Based System**: Players take turns drawing and guessing
- 🎯 **Auto-Start**: Game begins automatically when 2 players join

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18 or higher
- **npm** or **yarn**
- **Expo CLI** (for mobile development)
- **Android Studio** or **Xcode** (optional, for mobile emulators)

### 📦 Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/pictionary-app.git
cd pictionary-app
```

2. **Install dependencies for all components**

```bash
# Install server dependencies
cd server
npm install

# Install web app dependencies
cd ../web
npm install

# Install mobile app dependencies
cd ../mobile
npm install
```

## 🎮 Running the Game

### Step 1: Start the Server (Required)

The server must be running for the game to work.

```bash
cd server
npm start
```

The server will start on `http://localhost:3001`

You should see:

```
Pictionary WebSocket server listening on port 3001
```

### Step 2: Start the Web App

Open a new terminal:

```bash
cd web
npm run dev
```

The web app will be available at `http://localhost:5173`

### Step 3: Start the Mobile App

Open another terminal:

```bash
cd mobile
npx expo start
```

Then:

- Press `a` to open on Android emulator
- Press `i` to open on iOS simulator
- Scan the QR code with Expo Go app on your physical device

## 🎯 How to Play

### Game Flow

1. **Join the Game**

   - Enter your name on the welcome screen
   - Click "Join Game"

2. **Waiting Room**

   - First player sees "Waiting for players... 1/2"
   - Game starts automatically when 2nd player joins

3. **Playing**

   - **Drawer**:
     - Sees the word to draw at the top
     - Can draw on the canvas
     - Can clear the canvas
   - **Guesser**:
     - Sees the drawing in real-time
     - Types guesses in the chat
     - Wins points for correct guess

4. **Scoring**
   - Correct guess: Both drawer and guesser get 1 point
   - Roles switch after each correct guess

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the project root (optional):

```env
# Server configuration
PORT=3001
SERVER_PORT=3001

# Mobile configuration (in mobile/.env)
EXPO_PUBLIC_SERVER_URL=http://your-ip:3001
```

### Connecting from Different Devices

#### Mobile to Local Server

**Android Emulator:**

- Automatically connects to `http://10.0.2.2:3001`

**iOS Simulator:**

- Uses `http://localhost:3001`

**Physical Device:**

1. Find your computer's IP address:
   - Windows: `ipconfig` (look for IPv4 Address)
   - Mac/Linux: `ifconfig` or `ip addr`
2. Set in `mobile/.env`:
   ```
   EXPO_PUBLIC_SERVER_URL=http://192.168.1.100:3001
   ```
   (Replace with your actual IP)

## 📁 Project Structure

```
pictionary-app/
├── server/                 # Node.js Socket.IO server
│   ├── index.js           # Main server file
│   └── package.json       # Server dependencies
│
├── web/                   # React web application
│   ├── src/
│   │   └── App.tsx       # Main web app component
│   ├── index.html        # HTML entry point
│   └── package.json      # Web app dependencies
│
├── mobile/                # React Native mobile app
│   ├── src/
│   │   └── App.tsx       # Main mobile app component
│   ├── app.json          # Expo configuration
│   └── package.json      # Mobile app dependencies
│
└── README.md             # This file
```

## 🛠️ Technology Stack

### Backend

- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **Socket.IO** - Real-time bidirectional communication
- **CORS** - Cross-origin resource sharing

### Frontend (Web)

- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **Socket.IO Client** - WebSocket client

### Mobile

- **React Native** - Mobile framework
- **Expo SDK 53** - Development platform
- **TypeScript** - Type-safe JavaScript
- **React Native SVG** - Drawing canvas
- **Socket.IO Client** - WebSocket client

## 🐛 Troubleshooting

### Server Issues

**Port already in use:**

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :3001
kill -9 <PID>
```

### Mobile Connection Issues

**Can't connect to server:**

1. Ensure server is running
2. Check firewall settings
3. Verify IP address in EXPO_PUBLIC_SERVER_URL
4. Make sure devices are on same network

**Metro bundler issues:**

```bash
# Clear cache
npx expo start --clear
```

### Web App Issues

**Canvas not working:**

- Refresh the page after both players join
- Check browser console for errors
- Ensure you're the designated drawer

## 🎨 Game Features in Detail

### Drawing System

- Smooth, real-time drawing synchronization
- Pressure-sensitive on supported devices
- Clear button for mistakes
- Automatic canvas scaling across different screen sizes

### Chat System

- Real-time message delivery
- System messages for game events
- Player identification
- Guess validation

### Scoring System

- Points for correct guesses
- Points for successful drawings
- Persistent scores during session
- Score display for all players

## 🙏 Acknowledgments

- Built with React, React Native, and Socket.IO
- Inspired by the classic Pictionary board game

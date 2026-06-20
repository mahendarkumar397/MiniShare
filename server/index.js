const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your frontend domain
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('Mini-WeTransfer Signaling Server is running');
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create a room
  socket.on('create-room', () => {
    const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    socket.join(roomCode);
    socket.emit('room-created', roomCode);
    console.log(`User ${socket.id} created room: ${roomCode}`);
  });

  // Join a room
  socket.on('join-room', (roomCode) => {
    const room = io.sockets.adapter.rooms.get(roomCode);
    if (room && room.size > 0) {
      if (room.size >= 2 && !room.has(socket.id)) {
        socket.emit('room-error', 'Room is full');
        return;
      }
      socket.join(roomCode);
      socket.to(roomCode).emit('peer-joined', socket.id);
      socket.emit('room-joined', roomCode);
      console.log(`User ${socket.id} joined room: ${roomCode}`);
    } else {
      socket.emit('room-error', 'Room not found');
    }
  });

  // WebRTC Signaling relays
  socket.on('offer', ({ offer, roomCode }) => {
    socket.to(roomCode).emit('offer', offer);
  });

  socket.on('answer', ({ answer, roomCode }) => {
    socket.to(roomCode).emit('answer', answer);
  });

  socket.on('ice-candidate', ({ candidate, roomCode }) => {
    socket.to(roomCode).emit('ice-candidate', candidate);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Signaling Server listening on port ${PORT}`);
});

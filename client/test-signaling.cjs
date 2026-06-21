const { io } = require('socket.io-client');

const client1 = io('http://localhost:3001');
const client2 = io('http://localhost:3001');

client1.on('connect', () => {
  console.log('Client 1 connected:', client1.id);
  client1.emit('create-room');
});

let roomCode = null;

client1.on('room-created', (code) => {
  console.log('Client 1 created room:', code);
  roomCode = code;
  client2.connect();
});

client2.on('connect', () => {
  console.log('Client 2 connected:', client2.id);
  client2.emit('join-room', roomCode);
});

client2.on('room-joined', (code) => {
  console.log('Client 2 joined room:', code);
});

client1.on('peer-joined', (peerId) => {
  console.log('Client 1 saw peer join:', peerId);
  // Client 1 sends offer
  console.log('Client 1 sending offer to:', peerId);
  client1.emit('offer', { offer: { type: 'offer', sdp: 'fake-sdp' }, to: peerId });
});

client2.on('offer', ({ offer, from }) => {
  console.log('Client 2 received offer from:', from, offer);
  // Client 2 sends answer
  console.log('Client 2 sending answer to:', from);
  client2.emit('answer', { answer: { type: 'answer', sdp: 'fake-sdp' }, to: from });
});

client1.on('answer', ({ answer, from }) => {
  console.log('Client 1 received answer from:', from, answer);
  console.log('TEST PASSED');
  process.exit(0);
});

setTimeout(() => {
  console.error('TEST TIMED OUT');
  process.exit(1);
}, 3000);

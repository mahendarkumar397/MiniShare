<div align="center">
  <img src="client/public/icons.svg" alt="MiniShare Logo" width="120" />
</div>

<h1 align="center">MiniShare</h1>

<p align="center">
  <strong>A lightning-fast, secure, peer-to-peer file sharing application.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E" />
  <img src="https://img.shields.io/badge/Socket.io-010101?&style=for-the-badge&logo=Socket.io&logoColor=white" />
  <img src="https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" />
</p>

## 🚀 Overview

MiniShare is a modern web application that allows you to send files directly from one device to another without uploading them to any third-party server. By leveraging **WebRTC**, data flows purely Peer-to-Peer (P2P), meaning there are **no file size limits** and transfers happen at the maximum speed your network allows.

## ✨ Features

- 🔒 **End-to-End Encrypted**: Files are transferred securely using Datagram Transport Layer Security (DTLS).
- ⚡ **Lightning Fast**: Cuts out the middleman server completely.
- ♾️ **No Size Limits**: Share gigabytes of data effortlessly since nothing is stored on a server.
- 📱 **QR Code & Link Sharing**: Instantly generate a secure room code and share it via URL or QR code.
- 🎨 **Premium UI**: Beautiful, modern glassmorphism design with animated backgrounds.

## 🛠️ Tech Stack

- **Frontend**: React (Vite), Tailwind CSS, Framer Motion, Lucide React
- **Backend (Signaling)**: Node.js, Express, Socket.io
- **Core Technology**: WebRTC (RTCPeerConnection, RTCDataChannel)

## 📖 How It Works

1. **Select Files**: The sender creates a secure room and selects a file.
2. **Signal**: A Node.js signaling server relays the connection details (SDP offers/answers and ICE candidates) between the two peers.
3. **Connect**: A direct WebRTC connection is established between the sender and receiver.
4. **Transfer**: The file is chunked into an ArrayBuffer and streamed directly to the receiver over a WebRTC Data Channel.

## 💻 Running Locally

To run the project on your local machine, you will need two terminal windows.

### 1. Start the Signaling Server
```bash
cd server
npm install
npm run start
```
*The signaling server will start on `http://localhost:3001`*

### 2. Start the React Frontend
```bash
cd client
npm install
npm run dev
```
*The frontend will start on `http://localhost:5173`*

Open `http://localhost:5173` in your browser. Open a new tab or use a different device on the same network to join the room and test the file transfer!

## 📄 License
This project is open-source and available under the MIT License.

// This server now includes a simple relay for the disconnect message.
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3001;

const users = { 'user1@institution.com': 'pass1', 'user2@institution.com': 'pass2', 'user1@different.com': 'pass3' };
const accessKeys = {};
const activeUsers = {};

function getDomain(email) { return email?.split('@')[1] || null; }

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('login', ({ email, password }) => {
        if (users[email] && users[email] === password) {
            activeUsers[email] = socket.id;
            socket.email = email;
            socket.emit('login-success', { email });
        } else { socket.emit('login-fail'); }
    });
    
    socket.on('generate-access-key', () => {
        const key = Math.floor(100000 + Math.random() * 900000).toString();
        accessKeys[socket.email] = key;
        socket.emit('access-key-generated', key);
    });

    socket.on('offer', ({ targetEmail, sdp, accessKey }) => {
        const sourceEmail = socket.email;
        const targetSocketId = activeUsers[targetEmail];
        if (!targetSocketId) return;
        const isSameDomain = getDomain(sourceEmail) === getDomain(targetEmail);

        if (isSameDomain) {
            io.to(targetSocketId).emit('offer', { sdp, sourceEmail });
            return;
        }

        if (accessKey && accessKeys[targetEmail] && accessKeys[targetEmail] === accessKey) {
            delete accessKeys[targetEmail];
            io.to(targetSocketId).emit('offer', { sdp, sourceEmail });
        } else if (accessKey) {
            socket.emit('invalid-key');
        } else {
            socket.emit('cross-domain-requires-key');
        }
    });

    socket.on('answer', ({ targetEmail, sdp }) => {
        const targetSocketId = activeUsers[targetEmail];
        if (targetSocketId) io.to(targetSocketId).emit('answer', { sdp, sourceEmail: socket.email });
    });

    socket.on('ice-candidate', ({ targetEmail, candidate }) => {
        const targetSocketId = activeUsers[targetEmail];
        if (targetSocketId) io.to(targetSocketId).emit('ice-candidate', { candidate, sourceEmail: socket.email });
    });
    
    // --- NEW: A simple relay for the disconnect message ---
    socket.on('disconnect-peer', ({ targetEmail }) => {
        const targetSocketId = activeUsers[targetEmail];
        if (targetSocketId) {
            // Tell the other user that their partner has hung up.
            io.to(targetSocketId).emit('peer-disconnected');
        }
    });

    socket.on('disconnect', () => {
        if (socket.email) delete activeUsers[socket.email];
        console.log(`User disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => console.log(`🚀 Server is listening on port ${PORT}`));


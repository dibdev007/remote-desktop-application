// This is the complete renderer.js file with the disconnect logic.
console.log("--- Renderer script started ---");

const { ipcRenderer } = require('electron');
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let peerConnection, dataChannel, localEmail = '', pendingRemoteEmail = '';
const socket = io(SERVER_URL);

// --- HTML Element References (with disconnect button) ---
const loginView = document.getElementById('login-view'), emailInput = document.getElementById('email-input'), passwordInput = document.getElementById('password-input'), loginBtn = document.getElementById('login-btn'), loginError = document.getElementById('login-error');
const appView = document.getElementById('app-view'), localIdDisplay = document.getElementById('local-id-display'), remoteIdInput = document.getElementById('remote-id-input'), connectBtn = document.getElementById('connect-btn'), remoteVideo = document.getElementById('remote-video');
const generateKeyBtn = document.getElementById('generate-key-btn'), accessKeyDisplay = document.getElementById('access-key-display');
const keyModalOverlay = document.getElementById('key-modal-overlay'), keyInput = document.getElementById('key-input'), keySubmitBtn = document.getElementById('key-submit-btn'), keyCancelBtn = document.getElementById('key-cancel-btn');
const disconnectBtn = document.getElementById('disconnect-btn'); // New button reference

const keyMap = { "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right", "Enter": "enter", "Backspace": "backspace", "Tab": "tab", "Escape": "escape", "Shift": "shift", "Control": "control", "Alt": "alt", "Meta": "command", " ": "space" };

function getDomain(email) { return email?.split('@')[1] || null; }

// --- LOGIN & ACCESS KEY LOGIC (Unchanged) ---
loginBtn.addEventListener('click', () => { socket.emit('login', { email: emailInput.value, password: passwordInput.value }); });
socket.on('login-success', ({ email }) => { localEmail = email; loginView.style.display = 'none'; appView.style.display = 'flex'; localIdDisplay.innerText = localEmail; });
socket.on('login-fail', () => { loginError.style.display = 'block'; });
generateKeyBtn.addEventListener('click', () => { socket.emit('generate-access-key'); });
socket.on('access-key-generated', (key) => { accessKeyDisplay.innerText = key; setTimeout(() => { accessKeyDisplay.innerText = ''; }, 120000); });

// --- CONNECTION LOGIC & MODAL HANDLING (Unchanged) ---
connectBtn.addEventListener('click', () => {
    const remoteEmail = remoteIdInput.value;
    if (!remoteEmail || remoteEmail === localEmail) { return; }
    if (getDomain(localEmail) !== getDomain(remoteEmail)) {
        pendingRemoteEmail = remoteEmail;
        keyModalOverlay.style.display = 'flex';
        keyInput.focus();
    } else {
        startCall(remoteEmail, null);
    }
});
keySubmitBtn.addEventListener('click', () => {
    if (keyInput.value && pendingRemoteEmail) startCall(pendingRemoteEmail, keyInput.value);
    keyModalOverlay.style.display = 'none';
    keyInput.value = '';
    pendingRemoteEmail = '';
});
keyCancelBtn.addEventListener('click', () => {
    keyModalOverlay.style.display = 'none';
    keyInput.value = '';
    pendingRemoteEmail = '';
});
socket.on('cross-domain-requires-key', () => { alert('Connection failed: This is an untrusted cross-domain connection. Please use a one-time access key to authorize it.'); });
socket.on('invalid-key', () => { alert('Connection failed: The access key you entered is invalid. Please ask for a new key.'); });

// --- NEW: Disconnect button logic ---
disconnectBtn.addEventListener('click', () => {
    // Tell the other peer we are disconnecting
    const remoteEmail = remoteIdInput.value;
    socket.emit('disconnect-peer', { targetEmail: remoteEmail });
    handleDisconnect();
});

// --- NEW: A listener for when the other peer disconnects ---
socket.on('peer-disconnected', () => {
    console.log("The other user has disconnected.");
    handleDisconnect();
});

// --- NEW: Centralized function to handle all cleanup ---
function handleDisconnect() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    remoteIdInput.value = '';

    // Toggle the button visibility
    disconnectBtn.style.display = 'none';
    connectBtn.style.display = 'inline-block';
    remoteIdInput.style.display = 'inline-block';
}

// --- START CALL & SIGNALING (Unchanged) ---
async function startCall(remoteEmail, accessKey) {
    peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    setupPeerConnectionListeners(remoteEmail);
    dataChannel = peerConnection.createDataChannel('remote-control');
    setupDataChannelListeners();
    try {
        const sources = await ipcRenderer.invoke('get-screen-sources');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } } });
        stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { targetEmail: remoteEmail, sdp: offer, accessKey });
    } catch (error) { console.error("Error starting call:", error); }
}
socket.on('offer', async ({ sdp, sourceEmail }) => {
    peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    setupPeerConnectionListeners(sourceEmail);
    peerConnection.ondatachannel = (event) => { dataChannel = event.channel; setupDataChannelListeners(); };
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    try {
        const sources = await ipcRenderer.invoke('get-screen-sources');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } } });
        stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { targetEmail: sourceEmail, sdp: answer });
    } catch (error) { console.error("Error answering call:", error); }
});
socket.on('answer', async ({ sdp }) => { if (peerConnection && !peerConnection.currentRemoteDescription) await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp)); });
socket.on('ice-candidate', async ({ candidate }) => { if (peerConnection && candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); });

// --- UPDATED: Peer Connection listener now toggles buttons ---
function setupPeerConnectionListeners(targetEmail) {
    peerConnection.onicecandidate = (event) => { if (event.candidate) socket.emit('ice-candidate', { targetEmail, candidate: event.candidate }); };
    
    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        // --- UI CHANGE: A connection is active ---
        connectBtn.style.display = 'none';
        remoteIdInput.style.display = 'none';
        disconnectBtn.style.display = 'inline-block';
        setupRemoteControlListeners();
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection?.connectionState === 'disconnected' || peerConnection?.connectionState === 'closed' || peerConnection?.connectionState === 'failed') {
            handleDisconnect();
        }
    };
}

// --- REMOTE CONTROL LOGIC (Unchanged) ---
function setupDataChannelListeners() { dataChannel.onopen = () => console.log('Data channel open'); dataChannel.onclose = () => console.log('Data channel closed'); dataChannel.onmessage = (event) => ipcRenderer.send('remote-control', JSON.parse(event.data)); }
function setupRemoteControlListeners() { remoteVideo.addEventListener('mousemove', (e) => { const { offsetX, offsetY, clientWidth, clientHeight } = e.currentTarget; const data = { type: 'mousemove', x: offsetX / clientWidth, y: offsetY / clientHeight }; if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify(data)); }); remoteVideo.addEventListener('mousedown', () => { if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'mousedown' }))}); remoteVideo.addEventListener('mouseup', () => { if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'mouseup' }))}); remoteVideo.addEventListener('keydown', (e) => { e.preventDefault(); const key = keyMap[e.key] || e.key.toLowerCase(); const mods = []; if (e.ctrlKey) mods.push('control'); if (e.shiftKey) mods.push('shift'); if (e.altKey) mods.push('alt'); const data = { type: 'keydown', key, modifiers: mods }; if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify(data)); }); remoteVideo.addEventListener('keyup', (e) => { e.preventDefault(); const key = keyMap[e.key] || e.key.toLowerCase(); const mods = []; if (e.ctrlKey) mods.push('control'); if (e.shiftKey) mods.push('shift'); if (e.altKey) mods.push('alt'); const data = { type: 'keyup', key, modifiers: mods }; if (dataChannel?.readyState === 'open') dataChannel.send(JSON.stringify(data)); }); }


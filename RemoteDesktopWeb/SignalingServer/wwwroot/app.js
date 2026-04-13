const hubConnection = new signalR.HubConnectionBuilder()
    .withUrl("/signalingHub")
    .build();

let localStream = null;
let peerConnection = null;
let dataChannel = null;
let myId = null;
let connectedPeerId = null;
let isHost = false;

const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

// UI Elements
const statusDisplay = document.getElementById('statusDisplay');
const connectedClientDisplay = document.getElementById('connectedClientDisplay');
const btnShareScreen = document.getElementById('btnShareScreen');
const btnStopSharing = document.getElementById('btnStopSharing');
const pcNameInput = document.getElementById('pcNameInput');
const passwordInput = document.getElementById('passwordInput');
const hostListArea = document.getElementById('hostListArea');

const remoteViewSection = document.getElementById('remoteViewSection');
const remoteVideo = document.getElementById('remoteVideo');
const remoteCursor = document.getElementById('remoteCursor');
const btnRequestScreenSwitch = document.getElementById('btnRequestScreenSwitch');
const connectionSetupSection = document.getElementById('connectionSetupSection');
const toolsPanel = document.getElementById('toolsPanel');

const clipboardInput = document.getElementById('clipboardInput');
const btnSendClipboard = document.getElementById('btnSendClipboard');

const fileExpanderHeader = document.getElementById('fileExpanderHeader');
const fileExpander = document.getElementById('fileExpander');
const fileInput = document.getElementById('fileInput');
const btnSendFile = document.getElementById('btnSendFile');
const fileDownloadArea = document.getElementById('fileDownloadArea');
const btnDisconnect = document.getElementById('btnDisconnect');

// --- UI Interactions ---

fileExpanderHeader.addEventListener('click', () => {
    fileExpander.classList.toggle('open');
});

function showRemoteTools() {
    connectionSetupSection.style.display = 'none';
    toolsPanel.style.display = 'block';
    btnDisconnect.style.display = 'inline-block';

    if (!isHost) {
        remoteViewSection.style.display = 'block';
    } else {
        statusDisplay.innerText = "You are sharing your screen.";
    }
}

function hideRemoteTools(preserveHostState = false) {
    if (!preserveHostState) {
        connectionSetupSection.style.display = 'block';
        statusDisplay.innerText = "Disconnected";
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        btnShareScreen.style.display = 'inline-block';
        btnStopSharing.style.display = 'none';
        hubConnection.invoke("StopHosting");
    } else {
        statusDisplay.innerText = "Sharing registered. Waiting for another connection...";
    }

    toolsPanel.style.display = 'none';
    remoteViewSection.style.display = 'none';
    btnDisconnect.style.display = 'none';
    connectedClientDisplay.style.display = 'none';
    connectedClientDisplay.innerText = "";

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    connectedPeerId = null;
}

btnDisconnect.addEventListener('click', () => {
    hideRemoteTools();
});

// --- SignalR Signaling ---

hubConnection.on("ReceiveConnectionId", (id) => {
    myId = id;
});

hubConnection.on("UpdateHostList", (hosts) => {
    hostListArea.innerHTML = '';
    if (hosts.length === 0) {
        hostListArea.innerHTML = '<p>No hosts available.</p>';
        return;
    }

    hosts.forEach(host => {
        if (host.connectionId === myId) return; // Don't show self

        const div = document.createElement('div');
        div.className = 'host-item';

        const span = document.createElement('span');
        span.innerText = host.pcName; // Safely set text to prevent DOM XSS
        div.appendChild(span);

        const btn = document.createElement('button');
        btn.innerText = "Connect";
        btn.style.width = 'auto';
        btn.onclick = () => initiateConnection(host.connectionId);

        div.appendChild(btn);
        hostListArea.appendChild(div);
    });
});

hubConnection.on("ReceiveOffer", async (senderId, offer, clientName) => {
    console.log("Received Offer from", senderId);
    connectedPeerId = senderId;
    isHost = true;

    connectedClientDisplay.innerText = `${clientName || 'Unknown Client'} is connected and viewing your screen.`;
    connectedClientDisplay.style.display = 'block';

    if (!localStream) {
        await startScreenShareInternal();
    }

    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    hubConnection.invoke("SendAnswer", senderId, JSON.stringify(answer));
    showRemoteTools();
});

hubConnection.on("ReceiveAnswer", async (senderId, answer) => {
    console.log("Received Answer from", senderId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
    statusDisplay.innerText = "Connected!";
    showRemoteTools();
});

hubConnection.on("ReceiveIceCandidate", async (senderId, candidate) => {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
        }
    } catch (e) {
        console.error("Error adding received ice candidate", e);
    }
});

hubConnection.on("ConnectionFailed", (reason) => {
    alert("Connection failed: " + reason);
    hideRemoteTools();
});

hubConnection.start().then(() => {
    console.log("SignalR Connected");
}).catch(err => console.error(err));

// Fetch and pre-fill PC Name on load
fetch('/api/pcname')
    .then(res => res.json())
    .then(data => {
        if (data && data.pcName && !pcNameInput.value) {
            pcNameInput.value = data.pcName;
        }
    })
    .catch(err => console.error("Could not fetch PC Name:", err));

// --- WebRTC Setup ---

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate && connectedPeerId) {
            hubConnection.invoke("SendIceCandidate", connectedPeerId, JSON.stringify(event.candidate));
        }
    };

    peerConnection.onconnectionstatechange = event => {
        if (peerConnection.connectionState === 'connected') {
            statusDisplay.innerText = "Connected!";
        } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            // If we are the host, just drop the peer connection but stay sharing.
            if (isHost) {
                hideRemoteTools(true);
            } else {
                alert("Host disconnected.");
                hideRemoteTools(false);
            }
        }
    };

    if (isHost && localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    peerConnection.ontrack = event => {
        if (!isHost && event.track.kind === 'video') {
            if (!remoteVideo.srcObject) {
                remoteVideo.srcObject = new MediaStream();
            }
            remoteVideo.srcObject.addTrack(event.track);
        }
    };

    if (!isHost) {
        dataChannel = peerConnection.createDataChannel("controlChannel");
        setupDataChannel();
    } else {
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel();
        };
    }
}

function setupDataChannel() {
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => console.log("Data Channel Opened");
    dataChannel.onclose = () => console.log("Data Channel Closed");

    dataChannel.onmessage = event => {
        if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            handleDataChannelMessage(msg);
        } else {
            handleFileChunk(event.data);
        }
    };
}

// --- Interaction Logic ---

async function startScreenShareInternal() {
    // Screen sharing requires a Secure Context (HTTPS) or localhost
    if (!window.isSecureContext) {
        alert("Screen sharing requires a Secure Context. Please connect using HTTPS or localhost.");
        throw new Error("Insecure context");
    }

    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        // Handle user stopping screen share via browser UI
        localStream.getVideoTracks()[0].onended = () => {
             hideRemoteTools();
             hubConnection.invoke("StopHosting");
             btnShareScreen.style.display = 'inline-block';
             btnStopSharing.style.display = 'none';
        };
    } catch (err) {
        console.error("Error sharing screen: ", err);
        if (err.name === 'NotAllowedError') {
            alert("Permission to share screen was denied.");
        }
        throw err;
    }
}

btnShareScreen.addEventListener('click', () => {
    const name = pcNameInput.value.trim();
    const pwd = passwordInput.value.trim();

    if (!name) { alert("Please enter a PC Name"); return; }
    if (!pwd || pwd.length < 6 || pwd.length > 20) { alert("Please enter a password between 6 and 20 characters"); return; }

    // Register as host, but defer screen selection until someone connects
    hubConnection.invoke("RegisterHost", name, pwd);
    statusDisplay.innerText = "Sharing registered. Waiting for connection before selecting screen...";
    btnShareScreen.style.display = 'none';
    btnStopSharing.style.display = 'inline-block';
    isHost = true;
});

btnStopSharing.addEventListener('click', () => {
    hubConnection.invoke("StopHosting");
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    btnShareScreen.style.display = 'inline-block';
    btnStopSharing.style.display = 'none';
    statusDisplay.innerText = "Disconnected";
});

async function initiateConnection(targetId) {
    const pwd = prompt("Enter password for this PC:");
    if (pwd === null) return; // User cancelled

    connectedPeerId = targetId;
    isHost = false;
    createPeerConnection();

    // The client wants to receive video but is not sending any.
    // We must explicitly add a video transceiver to the offer.
    peerConnection.addTransceiver('video', { direction: 'recvonly' });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    statusDisplay.innerText = "Connecting...";
    const clientName = pcNameInput.value.trim() || "A Remote User";
    hubConnection.invoke("SendOffer", connectedPeerId, JSON.stringify(offer), pwd, clientName);
}


// --- Remote Control (Mouse Events) ---

remoteVideo.addEventListener('mousemove', (e) => {
    if (!dataChannel || dataChannel.readyState !== 'open') return;

    const rect = remoteVideo.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    dataChannel.send(JSON.stringify({ type: 'mousemove', x, y }));
});

remoteVideo.addEventListener('click', (e) => {
    if (!dataChannel || dataChannel.readyState !== 'open') return;

    const rect = remoteVideo.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    dataChannel.send(JSON.stringify({ type: 'click', x, y }));
});

remoteVideo.addEventListener('keydown', (e) => {
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    e.preventDefault(); // Stop page scrolling
    dataChannel.send(JSON.stringify({ type: 'keydown', key: e.key, code: e.code }));
});

remoteVideo.addEventListener('keyup', (e) => {
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    e.preventDefault();
    dataChannel.send(JSON.stringify({ type: 'keyup', key: e.key, code: e.code }));
});

btnRequestScreenSwitch.addEventListener('click', () => {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'request-screen-switch' }));
        alert("Requested screen switch from Host.");
    }
});


// --- Clipboard Sync ---

btnSendClipboard.addEventListener('click', () => {
    if (dataChannel && dataChannel.readyState === 'open') {
        const text = clipboardInput.value;
        dataChannel.send(JSON.stringify({ type: 'clipboard', text: text }));
        console.log("Clipboard text sent");
    } else {
        alert("Not connected");
    }
});


// --- File Transfer ---

let receiveBuffer = [];
let receivedSize = 0;
let incomingFileInfo = null;

btnSendFile.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file || !dataChannel || dataChannel.readyState !== 'open') return;

    console.log(`Sending file: ${file.name} (${file.size} bytes)`);

    dataChannel.send(JSON.stringify({
        type: 'file-start',
        name: file.name,
        size: file.size,
        mime: file.type
    }));

    const chunkSize = 16384;
    let offset = 0;
    const reader = new FileReader();
    const BUFFER_THRESHOLD = 65535;

    reader.onload = e => {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        if (offset < file.size) {
            if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                dataChannel.onbufferedamountlow = () => {
                    dataChannel.onbufferedamountlow = null;
                    readSlice(offset);
                };
            } else {
                readSlice(offset);
            }
        } else {
            console.log("File sent completely");
            dataChannel.send(JSON.stringify({ type: 'file-end' }));
        }
    };

    const readSlice = o => {
        const slice = file.slice(offset, o + chunkSize);
        reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
});

function handleDataChannelMessage(msg) {
    if (msg.type === 'mousemove') {
        // Only host should show the fake cursor
        if (isHost && document.visibilityState === 'visible') {
            remoteCursor.style.display = 'block';
            // Note: In a real app, this would control the OS cursor.
            // Here we just simulate it on the host's own screen view (if they had one).
            // Since host doesn't see a <video> of themselves, we'll just log it.
            // console.log(`Remote mouse move: x=${msg.x}, y=${msg.y}`);
        }
    } else if (msg.type === 'click') {
        console.log(`Remote click received: x=${msg.x}, y=${msg.y}`);
    } else if (msg.type === 'keydown') {
        console.log(`Remote keydown received: ${msg.key} (${msg.code})`);
    } else if (msg.type === 'keyup') {
        console.log(`Remote keyup received: ${msg.key} (${msg.code})`);
    } else if (msg.type === 'request-screen-switch' && isHost) {
        if (confirm("Remote user requested a screen switch. Share a new screen?")) {
            switchScreen();
        }
    } else if (msg.type === 'clipboard') {
        clipboardInput.value = msg.text;
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(msg.text).catch(err => console.error("Could not write to OS clipboard: ", err));
        }
        console.log("Received clipboard text");
    } else if (msg.type === 'file-start') {
        incomingFileInfo = msg;
        receiveBuffer = [];
        receivedSize = 0;
        console.log(`Receiving file: ${msg.name}`);
    } else if (msg.type === 'file-end') {
        const received = new Blob(receiveBuffer, { type: incomingFileInfo.mime });
        receiveBuffer = [];

        const url = URL.createObjectURL(received);
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = incomingFileInfo.name;
        downloadLink.textContent = `Download ${incomingFileInfo.name}`;
        downloadLink.style.display = 'block';

        downloadLink.onclick = () => {
            // Revoke object URL after a short delay to free memory
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        fileDownloadArea.appendChild(downloadLink);
        console.log("File reception complete");
    }
}

function handleFileChunk(data) {
    receiveBuffer.push(data);
    receivedSize += data.byteLength;
}

// Seamlessly switch screen
async function switchScreen() {
    try {
        const newStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const newVideoTrack = newStream.getVideoTracks()[0];

        // Find existing sender
        const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            await sender.replaceTrack(newVideoTrack);
        }

        // Stop old tracks
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
        }
        localStream = newStream;

        // Handle if user stops this new stream
        newVideoTrack.onended = () => {
             hideRemoteTools();
             hubConnection.invoke("StopHosting");
             btnShareScreen.style.display = 'inline-block';
             btnStopSharing.style.display = 'none';
        };

    } catch (err) {
        console.error("Screen switch failed or cancelled.", err);
    }
}

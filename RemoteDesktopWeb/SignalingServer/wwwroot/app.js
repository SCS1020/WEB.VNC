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
const btnShareScreen = document.getElementById('btnShareScreen');
const btnStopSharing = document.getElementById('btnStopSharing');
const pcNameInput = document.getElementById('pcNameInput');
const passwordInput = document.getElementById('passwordInput');
const hostListArea = document.getElementById('hostListArea');

const remoteViewSection = document.getElementById('remoteViewSection');
const remoteVideo = document.getElementById('remoteVideo');
const remoteCursor = document.getElementById('remoteCursor');
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

function hideRemoteTools() {
    connectionSetupSection.style.display = 'block';
    toolsPanel.style.display = 'none';
    remoteViewSection.style.display = 'none';
    btnDisconnect.style.display = 'none';
    statusDisplay.innerText = "Disconnected";

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
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
        div.innerHTML = `<span>${host.pcName}</span>`;

        const btn = document.createElement('button');
        btn.innerText = "Connect";
        btn.style.width = 'auto';
        btn.onclick = () => initiateConnection(host.connectionId);

        div.appendChild(btn);
        hostListArea.appendChild(div);
    });
});

hubConnection.on("ReceiveOffer", async (senderId, offer) => {
    console.log("Received Offer from", senderId);
    connectedPeerId = senderId;
    isHost = true;

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
            alert("Peer disconnected.");
            hideRemoteTools();
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
        throw err;
    }
}

btnShareScreen.addEventListener('click', async () => {
    const name = pcNameInput.value.trim();
    const pwd = passwordInput.value.trim();

    if (!name) { alert("Please enter a PC Name"); return; }
    if (!pwd || pwd.length > 5) { alert("Please enter a password (max 5 characters)"); return; }

    try {
        await startScreenShareInternal();
        hubConnection.invoke("RegisterHost", name, pwd);
        statusDisplay.innerText = "Sharing registered. Waiting for connection...";
        btnShareScreen.style.display = 'none';
        btnStopSharing.style.display = 'inline-block';
    } catch (err) {
        // Failed to get media
    }
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
    hubConnection.invoke("SendOffer", connectedPeerId, JSON.stringify(offer), pwd);
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

        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(received);
        downloadLink.download = incomingFileInfo.name;
        downloadLink.textContent = `Download ${incomingFileInfo.name}`;
        downloadLink.style.display = 'block';

        fileDownloadArea.appendChild(downloadLink);
        console.log("File reception complete");
    }
}

function handleFileChunk(data) {
    receiveBuffer.push(data);
    receivedSize += data.byteLength;
}

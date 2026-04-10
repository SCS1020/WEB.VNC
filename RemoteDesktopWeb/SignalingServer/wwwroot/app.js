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
        { urls: "stun:stun.l.google.com:19302" } // Public STUN server for hole punching
    ]
};

// UI Elements
const myIdDisplay = document.getElementById('myIdDisplay');
const statusDisplay = document.getElementById('statusDisplay');
const btnShareScreen = document.getElementById('btnShareScreen');
const btnConnect = document.getElementById('btnConnect');
const targetIdInput = document.getElementById('targetIdInput');
const remoteVideo = document.getElementById('remoteVideo');
const clipboardInput = document.getElementById('clipboardInput');
const btnSendClipboard = document.getElementById('btnSendClipboard');
const fileInput = document.getElementById('fileInput');
const btnSendFile = document.getElementById('btnSendFile');
const fileDownloadArea = document.getElementById('fileDownloadArea');

// --- SignalR Signaling ---

hubConnection.on("ReceiveConnectionId", (id) => {
    myId = id;
    myIdDisplay.innerText = myId;
});

hubConnection.on("ReceiveOffer", async (senderId, offer) => {
    console.log("Received Offer from", senderId);
    connectedPeerId = senderId;
    isHost = true; // The one receiving the offer is the Host (providing screen)

    // Auto-start screen share if not already started
    if (!localStream) {
        await startScreenShare();
    }

    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    hubConnection.invoke("SendAnswer", senderId, JSON.stringify(answer));
});

hubConnection.on("ReceiveAnswer", async (senderId, answer) => {
    console.log("Received Answer from", senderId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
    statusDisplay.innerText = "Connected!";
});

hubConnection.on("ReceiveIceCandidate", async (senderId, candidate) => {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
    } catch (e) {
        console.error("Error adding received ice candidate", e);
    }
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
        } else if (peerConnection.connectionState === 'disconnected') {
            statusDisplay.innerText = "Disconnected!";
        }
    };

    // If I am the Host, add local stream tracks to PC
    if (isHost && localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // If I am the Client, receive tracks
    peerConnection.ontrack = event => {
        if (!isHost) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Data Channel Setup
    if (!isHost) {
        // Client creates the data channel
        dataChannel = peerConnection.createDataChannel("controlChannel");
        setupDataChannel();
    } else {
        // Host receives the data channel
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

async function startScreenShare() {
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        isHost = true;
        statusDisplay.innerText = "Screen shared. Waiting for connection...";
    } catch (err) {
        console.error("Error sharing screen: ", err);
    }
}

btnShareScreen.addEventListener('click', async () => {
    await startScreenShare();
});

btnConnect.addEventListener('click', async () => {
    connectedPeerId = targetIdInput.value;
    if (!connectedPeerId) return;

    isHost = false; // The one initiating connection is the Client (viewer)
    createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    statusDisplay.innerText = "Connecting...";
    hubConnection.invoke("SendOffer", connectedPeerId, JSON.stringify(offer));
});


// --- Remote Control (Mouse Events) ---
// Note: Actual OS-level control requires a native app on the Host side.
// Web browsers cannot control the host OS mouse directly for security reasons.
// We will send the coordinates over DataChannel to demonstrate communication.

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

    // 1. Send file metadata
    dataChannel.send(JSON.stringify({
        type: 'file-start',
        name: file.name,
        size: file.size,
        mime: file.type
    }));

    // 2. Read and send chunks
    const chunkSize = 16384; // 16KB
    let offset = 0;
    const reader = new FileReader();

    // The threshold to pause writing
    const BUFFER_THRESHOLD = 65535;

    reader.onload = e => {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        if (offset < file.size) {
            if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                // Wait for the buffer to empty out before sending more
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
        // If we were a native app, we'd move the OS mouse here.
        // console.log(`Remote mouse move: x=${msg.x}, y=${msg.y}`);
    } else if (msg.type === 'click') {
        // If we were a native app, we'd trigger OS click here.
        console.log(`Remote click: x=${msg.x}, y=${msg.y}`);
    } else if (msg.type === 'clipboard') {
        // Update local clipboard UI and attempt to write to system clipboard
        clipboardInput.value = msg.text;
        navigator.clipboard.writeText(msg.text).catch(err => console.error("Could not write to OS clipboard: ", err));
        console.log("Received clipboard text");
    } else if (msg.type === 'file-start') {
        incomingFileInfo = msg;
        receiveBuffer = [];
        receivedSize = 0;
        console.log(`Receiving file: ${msg.name}`);
    } else if (msg.type === 'file-end') {
        const received = new Blob(receiveBuffer, { type: incomingFileInfo.mime });
        receiveBuffer = []; // clear buffer

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
    // console.log(`Received chunk: ${data.byteLength} bytes. Total: ${receivedSize}`);
}

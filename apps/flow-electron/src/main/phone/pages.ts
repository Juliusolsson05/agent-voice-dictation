// These pages are served locally and contain no third-party scripts, analytics,
// STT keys or transcript endpoints. A static HTML shell also works before the
// phone has internet access or has trusted this installation's local CA.
const head = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Agent Voice · Phone microphone</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101714;color:#eef6f0;font:17px/1.55 -apple-system,system-ui,sans-serif;padding:34px 24px}main{max-width:560px;margin:auto}small{color:#b8c7bf}h1{font-size:36px;line-height:1.1;letter-spacing:-1px}h2{font-size:20px}button,.button{display:block;width:100%;padding:17px;border:0;border-radius:14px;background:#a9efbd;color:#092e17;font:600 18px system-ui;text-align:center;text-decoration:none;margin:18px 0}button:disabled{opacity:.5}a{color:#a9efbd}li{margin-bottom:15px}meter{width:100%;height:24px}code{overflow-wrap:anywhere;font-size:12px}.card{padding:18px;background:#1b2922;border-radius:16px;margin:20px 0}#status{min-height:56px}#disconnect{background:#2d3d33;color:white}</style><main><small>AGENT VOICE / LOCAL NETWORK</small>`

export function setupPage(securePort: number, fingerprint: string): string {
  return `${head}<h1>Your phone.<br>Your microphone.</h1><p>One-time iPhone setup for an encrypted connection to your Mac.</p><ol><li><a href="/ca.cer">Download Agent Voice certificate</a> and allow the profile download.</li><li>Open iPhone <b>Settings → General → VPN &amp; Device Management</b>. Install “Agent Voice Phone Microphone”.</li><li>Open <b>Settings → General → About → Certificate Trust Settings</b>. Enable full trust for “Agent Voice Phone Microphone”.</li><li>Return here and open the microphone below.</li></ol><div class="card"><small>This trusts a certificate authority whose private key stays on your Mac. Only install your own Agent Voice certificate. If Chrome downloads a file without an install prompt, open this setup link in Safari to install the profile, then use Chrome for the microphone. Compare its SHA-256 fingerprint with the one shown in the Mac app:</small><p><code>${fingerprint}</code></p><small>You can remove the profile after you stop using phone microphone.</small></div><a id="open" class="button">Open microphone</a><p><small>Use the same Wi-Fi on both devices. Guest networks may block device-to-device connections. If Chrome shows a certificate warning, complete the trust steps first.</small></p><script>document.getElementById('open').href='https://'+location.hostname+':${securePort}/'+location.hash;</script></main></html>`
}

export const microphonePage = `${head}<h1>Phone microphone</h1><p id="status" role="status">Tap Connect and allow microphone access.</p><meter id="level" min="0" max="1" value="0" aria-label="Microphone level"></meter><button id="connect">Connect microphone</button><button id="disconnect" hidden>Disconnect</button><div class="card">Keep this page open and your phone unlocked.<br><small>The meter stays local. Agent Voice sends audio to your selected transcription provider only when you dictate on the Mac. Stop disconnects the microphone.</small></div><script src="/phone.js"></script></main></html>`

export const phoneScript = String.raw`
const status=document.getElementById('status'), connect=document.getElementById('connect'), disconnect=document.getElementById('disconnect'), meter=document.getElementById('level');
const token=location.hash.slice(1); history.replaceState(null,'',location.pathname);
let peer, socket, stream, context, wake, timer, deadline, generation=0;
function stop(message='Disconnected. Tap Connect to reconnect.'){
  generation++; clearInterval(timer);clearTimeout(deadline); peer?.close();peer=null;
  if(socket){socket.onclose=null;socket.close();socket=null;}
  stream?.getTracks().forEach(t=>t.stop());stream=null;context?.close().catch(()=>{});context=null;
  wake?.release().catch(()=>{});wake=null;meter.value=0;connect.disabled=false;disconnect.hidden=true;status.textContent=message;
}
disconnect.onclick=()=>stop();
connect.onclick=async()=>{
  stop('Connecting…'); const gen=generation;connect.disabled=true;disconnect.hidden=false;
  try{
    if(!token) throw Error('Scan the pairing QR code in Agent Voice settings again.');
    if(!navigator.mediaDevices?.getUserMedia) throw Error('Microphone access requires trusted HTTPS. Complete the certificate setup.');
    const captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(gen!==generation){captured.getTracks().forEach(t=>t.stop());return;}stream=captured;
    context=new AudioContext();await context.resume();if(gen!==generation)return;
    const source=context.createMediaStreamSource(stream), analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);const data=new Float32Array(analyser.fftSize);
    timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);meter.value=Math.min(1,Math.sqrt(data.reduce((n,v)=>n+v*v,0)/data.length)*5);},100);
    stream.getAudioTracks()[0].onended=()=>stop('Microphone stopped. Tap Connect again.');
    const pc=new RTCPeerConnection({iceServers:[]});peer=pc;stream.getTracks().forEach(track=>pc.addTrack(track,stream));
    const ws=new WebSocket('wss://'+location.host+'/signal');socket=ws;const candidates=[];let offered=false;let chain=Promise.resolve();
    const send=msg=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));};
    pc.onicecandidate=e=>{if(e.candidate){const msg={type:'candidate',candidate:e.candidate.toJSON()};if(offered)send(msg);else candidates.push(msg);}};
    pc.onconnectionstatechange=()=>{if(gen!==generation)return;if(pc.connectionState==='connected'){clearTimeout(deadline);status.textContent='Connected. Use your keyboard or mouse shortcut in Agent Voice.';}else if(['failed','disconnected','closed'].includes(pc.connectionState))stop('Connection lost. Keep this page open and tap Connect again.');};
    ws.onopen=()=>send({type:'pair',token});
    ws.onmessage=e=>{chain=chain.then(async()=>{if(gen!==generation)return;const msg=JSON.parse(e.data);if(msg.type==='paired'){await pc.setLocalDescription(await pc.createOffer());send({type:'offer',sdp:pc.localDescription.sdp});offered=true;candidates.forEach(send);}else if(msg.type==='answer')await pc.setRemoteDescription(msg);else if(msg.type==='candidate')await pc.addIceCandidate(msg.candidate);}).catch(e=>{if(gen===generation)stop(e.message);});};
    ws.onclose=()=>{if(gen===generation)stop('Connection closed. Scan a fresh QR code if you restarted the server.');};
    ws.onerror=()=>{if(gen===generation)stop('Cannot reach Agent Voice. Check Wi-Fi, certificate trust and whether the server is running.');};
    deadline=setTimeout(()=>{if(gen===generation)stop('Connection timed out. This Wi-Fi may block connections between devices. Try a private Wi-Fi network.');},20000);
    try{const lock=await navigator.wakeLock?.request('screen');if(gen!==generation)await lock?.release();else wake=lock;}catch{}
  }catch(e){if(gen===generation)stop(e.message||'Could not open microphone.');}
};
// iOS may suspend media or sockets in background. Disconnect explicitly rather
// than leave the desktop reporting a working microphone that is sending silence.
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Page paused. Keep Chrome visible and tap Connect again.');});
window.addEventListener('pagehide',()=>stop());
`

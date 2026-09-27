// This document receives only WebRTC SDP/session state. Credentials remain native.
export const PLAYER_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#151621;height:100%;overflow:hidden}video{width:100%;height:100%;object-fit:contain}</style></head><body><video id="video" autoplay playsinline muted></video><script>
let pc, timeout, closed=false;
const send=(data)=>window.ReactNativeWebView.postMessage(JSON.stringify(data));
window.receive=async(data)=>{try{if(data.kind==='answer'&&!closed){await pc.setRemoteDescription({type:'answer',sdp:data.sdp});}if(data.kind==='stop'){closed=true;clearTimeout(timeout);if(pc)pc.close();document.getElementById('video').srcObject=null;}}catch(e){send({kind:'error',message:'Unable to connect to video.'});}};
(async()=>{try{
pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
pc.ontrack=e=>{const v=document.getElementById('video');v.srcObject=e.streams[0]||new MediaStream([e.track]);v.play().catch(()=>send({kind:'error',message:'Tap the video to play.'}));};
document.getElementById('video').onplaying=()=>{clearTimeout(timeout);send({kind:'playing'});};
document.getElementById('video').onclick=()=>document.getElementById('video').play();
pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState))send({kind:'error',message:'Video connection interrupted.'});};
pc.addTransceiver('video',{direction:'recvonly'});await pc.setLocalDescription(await pc.createOffer());
await new Promise(resolve=>{let timer=setTimeout(resolve,6000);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}};if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});
if(!closed){send({kind:'offer',sdp:pc.localDescription.sdp});timeout=setTimeout(()=>send({kind:'error',message:'Video connection timed out. Try reconnecting.'}),30000);}
}catch(e){send({kind:'error',message:'Live video is unavailable on this device.'});}})();
</script></body></html>`;

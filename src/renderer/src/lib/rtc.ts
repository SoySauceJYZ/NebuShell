// 远程桌面 WebRTC 连接工厂。
// 场景为「同局域网 / 可直连 IP」,双方无 NAT,靠主机候选(host candidates)即可直连,
// 因此不配置任何 STUN/TURN——既省一次外网往返,也保证纯内网/离线可用。
export function createPeer(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [] })
}

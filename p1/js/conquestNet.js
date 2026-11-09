import * as THREE from 'three'
import { findSingleNode } from './util.js'

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyADQsR9T1t31XEg7gvyBj-k-WViVsqhfKs',
  authDomain: 'boxracing-17cbf.firebaseapp.com',
  projectId: 'boxracing-17cbf',
  storageBucket: 'boxracing-17cbf.appspot.com',
  messagingSenderId: '914670482439',
  appId: '1:914670482439:web:ca3871c498844a594aa6a2',
}

export class RemoteObject {
  static INACTIVE_THRESHOLD_SECONDS = 5.0

  constructor(peerId, initialState) {
    this.peerId = peerId
    this.state = {}
    this.lastUpdate = Date.now()
    this.updateState(initialState)
  }

  updateState(state) {
    if (!state) return
    this.state = { ...state }
    this.lastUpdate = Date.now()
  }

  isActive() {
    return (Date.now() - this.lastUpdate) / 1000 < RemoteObject.INACTIVE_THRESHOLD_SECONDS
  }

  getState() {
    return {
      ...this.state,
      lastUpdate: this.lastUpdate,
      active: this.isActive(),
    }
  }
}

export class SignalingManager {
  constructor(db, onPeerConnect, onPeerDisconnect, onStatusUpdate) {
    this.db = db
    this.onPeerConnect = onPeerConnect
    this.onPeerDisconnect = onPeerDisconnect
    this.onStatusUpdate = onStatusUpdate
    this.myPeerId = this.generateId('peer_')
    this.isHost = false
    this.hostId = null
    this.hostListener = null
    this.signalListener = null
    this.heartbeatInterval = null
  }

  generateId(prefix) {
    const validNums = '23456789'
    const validChars = 'abcdefghjkmnpqrstuvwxyz'
    return (
      prefix +
      validChars[Math.floor(Math.random() * validChars.length)] +
      validChars[Math.floor(Math.random() * validChars.length)] +
      validNums[Math.floor(Math.random() * validNums.length)] +
      validNums[Math.floor(Math.random() * validNums.length)] +
      validNums[Math.floor(Math.random() * validNums.length)]
    )
  }

  async findOrBecomeServer(requestedGameId = null) {
    this.onStatusUpdate('Connecting to Firestore…')

    if (requestedGameId) {
      const requestedDoc = await this.db.collection('conquest_servers').doc(requestedGameId).get()
      if (requestedDoc.exists) {
        await this.joinServer(requestedDoc.id, requestedDoc.data())
        return
      }
    }

    const serversQuery = await this.db
      .collection('conquest_servers')
      .where('can_join', '==', true)
      .limit(5)
      .get()

    const now = Date.now()
    const activeDoc = serversQuery.docs.find(doc => {
      const updated = doc.data()?.updated_at?.toDate?.()
      return updated && now - updated.getTime() < 60000
    })

    if (activeDoc) {
      await this.joinServer(activeDoc.id, activeDoc.data())
    } else {
      await this.becomeServer(requestedGameId)
    }
  }

  async becomeServer(customId = null) {
    this.myPeerId = customId || this.generateId('game_')
    this.isHost = true
    this.hostId = this.myPeerId

    const hostRef = this.db.collection('conquest_servers').doc(this.myPeerId)
    await hostRef.set({
      id: this.myPeerId,
      updated_at: window.firebase.firestore.FieldValue.serverTimestamp(),
      can_join: true,
    })

    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
    this.heartbeatInterval = setInterval(() => {
      if (this.isHost) {
        hostRef.update({
          updated_at: window.firebase.firestore.FieldValue.serverTimestamp(),
        })
      }
    }, 30000)

    this.onStatusUpdate(`Live Host · ${this.myPeerId}`)
    this.setupFirestoreListeners()
  }

  async joinServer(serverHostId, hostData) {
    this.myPeerId = this.generateId('client_')
    this.isHost = false
    this.hostId = serverHostId

    if (this.hostListener) this.hostListener()
    this.hostListener = this.db
      .collection('conquest_servers')
      .doc(this.hostId)
      .onSnapshot(doc => {
        if (!doc.exists && !this.isHost) {
          this.onPeerDisconnect()
        }
      })

    this.onPeerConnect(hostData.id)
    this.onStatusUpdate(`Live Client · ${hostData.id}`)
    this.setupFirestoreListeners()
  }

  setupFirestoreListeners() {
    const serverId = this.isHost ? this.myPeerId : this.hostId
    if (this.signalListener) this.signalListener()
    this.signalListener = this.db
      .collection(`conquest_servers/${serverId}/signaling_messages`)
      .where('to', '==', this.myPeerId)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          if (change.type === 'added') {
            const signalData = change.doc.data()
            await this.handleSignaling(signalData)
            await change.doc.ref.delete()
          }
        })
      })

    window.addEventListener('beforeunload', () => {
      if (this.isHost) {
        this.db.collection('conquest_servers').doc(this.myPeerId).delete()
      }
    })
  }

  async sendSignaling(targetPeerId, data) {
    const serverId = this.isHost ? this.myPeerId : this.hostId
    const serializedData = {
      ...data,
      from: this.myPeerId,
      to: targetPeerId,
      timestamp: window.firebase.firestore.FieldValue.serverTimestamp(),
    }

    if (data.offer) {
      serializedData.offer = { type: data.offer.type, sdp: data.offer.sdp }
    }
    if (data.answer) {
      serializedData.answer = { type: data.answer.type, sdp: data.answer.sdp }
    }
    if (data.candidate) {
      serializedData.candidate = {
        candidate: data.candidate.candidate,
        sdpMLineIndex: data.candidate.sdpMLineIndex,
        sdpMid: data.candidate.sdpMid,
        usernameFragment: data.candidate.usernameFragment,
      }
    }

    await this.db.collection(`conquest_servers/${serverId}/signaling_messages`).add(serializedData)
  }

  async handleSignaling(signalData) {
    if (signalData.type === 'offer') {
      this.onPeerConnect(signalData.from, {
        type: 'offer',
        offer: new RTCSessionDescription(signalData.offer),
      })
    } else if (signalData.type === 'answer') {
      this.onPeerConnect(signalData.from, {
        type: 'answer',
        answer: new RTCSessionDescription(signalData.answer),
      })
    } else if (signalData.type === 'ice-candidate' && signalData.candidate?.candidate) {
      this.onPeerConnect(signalData.from, {
        type: 'ice-candidate',
        candidate: new RTCIceCandidate(signalData.candidate),
      })
    }
  }
}

export class ConquestNet {
  constructor(scene, { islandId = 'island-1' } = {}) {
    this.scene = scene
    this.islandId = islandId
    this.sessionId = `p_${Math.random().toString(36).slice(2, 9)}`
    this.eventHandlers = new Map()
    this.remotePeers = new Map()
    this.rtcPeerConnections = new Map()
    this.dataChannels = new Map()
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    }
    this.statusText = 'Connecting…'
  }

  on(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, [])
    }
    this.eventHandlers.get(eventName).push(handler)
  }

  emit(eventName, payload) {
    const handlers = this.eventHandlers.get(eventName)
    if (!handlers) return
    for (const fn of handlers) fn(payload)
  }

  async init(defaultIslandState) {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(FIREBASE_CONFIG)
    }
    this.db = window.firebase.firestore()

    this.islandRef = this.db.collection('conquest_islands').doc(this.islandId)
    this.islandUnsubscribe = this.islandRef.onSnapshot(doc => {
      if (doc.exists) {
        this.emit('island-state', doc.data())
      } else {
        this.islandRef.set(defaultIslandState)
      }
    })

    const params = new URLSearchParams(window.location.search)
    const requestedGameId = params.get('gameId')

    this.signaling = new SignalingManager(
      this.db,
      (peerId, signalData) => {
        if (signalData) this.handlePeerSignal(peerId, signalData)
        else this.initiateWebRTCConnection(peerId)
      },
      () => this.cleanupWebRTC(),
      status => this.updateStatus(status)
    )

    await this.signaling.findOrBecomeServer(requestedGameId)
  }

  updateStatus(text) {
    this.statusText = text
    this.emit('status', {
      statusText: this.statusText,
      peerCount: this.getActivePeerCount(),
      serverId: this.signaling.hostId,
    })
  }

  getActivePeerCount() {
    const now = Date.now()
    for (const [peerId, remote] of this.remotePeers.entries()) {
      if (now - remote.lastUpdate > 5000) {
        this.remotePeers.delete(peerId)
        this.emit('peer-left', peerId)
      }
    }
    return 1 + this.remotePeers.size
  }

  publishIslandState(state) {
    this.sendPacket({
      type: 'island-state',
      senderId: this.sessionId,
      state,
    })
    this.islandRef.set({
      ...state,
      updated_at: Date.now(),
    })
  }

  publishTruckState(truckPayload) {
    this.sendPacket({
      type: 'truck-state',
      senderId: this.sessionId,
      truck: truckPayload,
    })
  }

  publishShot(shotPayload) {
    this.sendPacket({
      type: 'shot',
      senderId: this.sessionId,
      shot: shotPayload,
    })
  }

  sendPacket(packet) {
    const raw = JSON.stringify(packet)
    for (const channel of this.dataChannels.values()) {
      if (channel.readyState === 'open') {
        channel.send(raw)
      }
    }
  }

  handleIncomingPacket(packet, sourcePeerId) {
    if (!packet || packet.senderId === this.sessionId) return

    if (packet.type === 'truck-state' && packet.truck) {
      let remoteObj = this.remotePeers.get(packet.senderId)
      if (!remoteObj) {
        remoteObj = new RemoteObject(packet.senderId, packet.truck)
        this.remotePeers.set(packet.senderId, remoteObj)
      } else {
        remoteObj.updateState(packet.truck)
      }
      this.emit('remote-truck', { peerId: packet.senderId, state: packet.truck })
    } else if (packet.type === 'shot' && packet.shot) {
      this.emit('remote-shot', packet.shot)
    } else if (packet.type === 'island-state' && packet.state) {
      this.emit('island-state', packet.state)
    }

    if (this.signaling.isHost && sourcePeerId) {
      const raw = JSON.stringify(packet)
      for (const [otherPeerId, channel] of this.dataChannels.entries()) {
        if (otherPeerId !== sourcePeerId && channel.readyState === 'open') {
          channel.send(raw)
        }
      }
    }
  }

  async initiateWebRTCConnection(peerId) {
    const pc = new RTCPeerConnection(this.rtcConfig)
    this.rtcPeerConnections.set(peerId, pc)

    const channel = pc.createDataChannel('gameData')
    this.setupDataChannel(channel, peerId)

    pc.onicecandidate = event => {
      if (event.candidate) {
        this.signaling.sendSignaling(peerId, {
          type: 'ice-candidate',
          candidate: event.candidate,
        })
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await this.signaling.sendSignaling(peerId, { type: 'offer', offer })
  }

  async handlePeerSignal(peerId, signalData) {
    if (signalData.type === 'offer') {
      const pc = new RTCPeerConnection(this.rtcConfig)
      this.rtcPeerConnections.set(peerId, pc)

      pc.ondatachannel = event => {
        this.setupDataChannel(event.channel, peerId)
      }

      pc.onicecandidate = event => {
        if (event.candidate) {
          this.signaling.sendSignaling(peerId, {
            type: 'ice-candidate',
            candidate: event.candidate,
          })
        }
      }

      await pc.setRemoteDescription(signalData.offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await this.signaling.sendSignaling(peerId, { type: 'answer', answer })
    } else if (signalData.type === 'answer') {
      const pc = this.rtcPeerConnections.get(peerId)
      if (pc) await pc.setRemoteDescription(signalData.answer)
    } else if (signalData.type === 'ice-candidate') {
      const pc = this.rtcPeerConnections.get(peerId)
      if (pc) await pc.addIceCandidate(signalData.candidate)
    }
  }

  setupDataChannel(channel, peerId) {
    this.dataChannels.set(peerId, channel)
    channel.onopen = () => {
      this.updateStatus(this.statusText)
    }
    channel.onclose = () => {
      this.dataChannels.delete(peerId)
      this.rtcPeerConnections.delete(peerId)
      this.updateStatus(this.statusText)
    }
    channel.onmessage = event => {
      const packet = JSON.parse(event.data)
      this.handleIncomingPacket(packet, peerId)
    }
  }

  cleanupWebRTC() {
    for (const ch of this.dataChannels.values()) ch.close()
    for (const pc of this.rtcPeerConnections.values()) pc.close()
    this.dataChannels.clear()
    this.rtcPeerConnections.clear()
  }

  getInviteUrl() {
    const url = new URL(window.location.href)
    url.searchParams.set('island', this.islandId)
    url.searchParams.set('gameId', this.signaling.hostId)
    return url.toString()
  }
}

export class RemoteTruck {
  constructor(scene, peerId, initialState = {}) {
    this.scene = scene
    this.peerId = peerId
    this.team = initialState.team || 'blue'
    this.playerName = initialState.name || peerId.slice(0, 6).toUpperCase()
    this.targetPos = new THREE.Vector3(initialState.x || 0, initialState.y || 2, initialState.z || 0)
    this.targetQuat = new THREE.Quaternion(
      initialState.qx || 0,
      initialState.qy || 0,
      initialState.qz || 0,
      initialState.qw ?? 1
    )

    const truckScene = scene.getGltf('/assets/glb/blockbench-truck.glb').scene.clone(true)
    this.root = findSingleNode(truckScene, 'body')
    this.root.position.copy(this.targetPos)
    this.root.quaternion.copy(this.targetQuat)

    const teamBadgeGeo = new THREE.ConeGeometry(0.9, 1.4, 4)
    this.teamBadgeMat = new THREE.MeshBasicMaterial({
      color: this.team === 'red' ? 0xff4d4d : 0x4da6ff,
    })
    this.teamBadge = new THREE.Mesh(teamBadgeGeo, this.teamBadgeMat)
    this.teamBadge.position.set(0, 3.2, 0)
    this.teamBadge.rotation.x = Math.PI
    this.root.add(this.teamBadge)

    this.createBillboard()
    scene.scene.add(this.root)
  }

  createBillboard() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 256
    this.canvas.height = 64
    this.texture = new THREE.CanvasTexture(this.canvas)
    const spriteMat = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false })
    this.billboard = new THREE.Sprite(spriteMat)
    this.billboard.position.set(0, 4.6, 0)
    this.billboard.scale.set(5.5, 1.35, 1)
    this.root.add(this.billboard)
    this.drawBillboard()
  }

  drawBillboard() {
    const ctx = this.canvas.getContext('2d')
    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = 'rgba(12, 16, 22, 0.85)'
    ctx.fillRect(4, 4, 248, 56)
    ctx.strokeStyle = this.team === 'red' ? '#ff5252' : '#4da6ff'
    ctx.lineWidth = 4
    ctx.strokeRect(4, 4, 248, 56)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 24px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${this.playerName} [${this.team.toUpperCase()}]`, 128, 32)
    this.texture.needsUpdate = true
  }

  applyNetworkState(state) {
    this.targetPos.set(state.x, state.y, state.z)
    this.targetQuat.set(state.qx, state.qy, state.qz, state.qw)
    let needsRedraw = false
    if (state.team && state.team !== this.team) {
      this.team = state.team
      this.teamBadgeMat.color.setHex(this.team === 'red' ? 0xff4d4d : 0x4da6ff)
      needsRedraw = true
    }
    if (state.name && state.name !== this.playerName) {
      this.playerName = state.name
      needsRedraw = true
    }
    if (needsRedraw) {
      this.drawBillboard()
    }
  }

  update(dt) {
    const alpha = Math.min(1, dt * 12)
    this.root.position.lerp(this.targetPos, alpha)
    this.root.quaternion.slerp(this.targetQuat, alpha)
    this.teamBadge.rotation.y += dt * 2.5
  }

  dispose() {
    this.scene.scene.remove(this.root)
    this.texture.dispose()
    this.billboard.material.dispose()
  }
}

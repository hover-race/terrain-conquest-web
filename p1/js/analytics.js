export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyADQsR9T1t31XEg7gvyBj-k-WViVsqhfKs',
  authDomain: 'boxracing-17cbf.firebaseapp.com',
  projectId: 'boxracing-17cbf',
  storageBucket: 'boxracing-17cbf.appspot.com',
  messagingSenderId: '914670482439',
  appId: '1:914670482439:web:ca3871c498844a594aa6a2',
}

export const FUNNEL_STEPS = [
  { key: 'page_load', label: 'Page Load' },
  { key: 'm1_start', label: 'M1 Start' },
  { key: 'm1_win', label: 'M1 Win' },
  { key: 'm2_start', label: 'M2 Start' },
  { key: 'm2_win', label: 'M2 Win' },
  { key: 'm3_start', label: 'M3 Start' },
  { key: 'm3_hitch', label: 'M3 Hitch' },
  { key: 'm3_ammo_delivered', label: 'M3 Ammo Delivered' },
  { key: 'm3_win', label: 'M3 Win' },
  { key: 'island1_join', label: 'Island 1 Join' },
  { key: 'island1_tower_captured', label: 'Tower Captured' },
]

let sessionId = null
let pageLoadTracked = false

const SESSION_NAME_KEY = 'cq_session_name'
const COMPLETED_MISSIONS_KEY = 'cq_completed_missions'

function getSessionId() {
  if (sessionId) return sessionId
  const existing = window.sessionStorage.getItem('cq_analytics_session_id')
  if (existing) {
    sessionId = existing
    return sessionId
  }
  sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  window.sessionStorage.setItem('cq_analytics_session_id', sessionId)
  return sessionId
}

export function getSessionName() {
  return (window.localStorage.getItem(SESSION_NAME_KEY) || '').trim()
}

export function setSessionName(name) {
  const cleaned = String(name || '')
    .trim()
    .slice(0, 24)
  if (cleaned) {
    window.localStorage.setItem(SESSION_NAME_KEY, cleaned)
  } else {
    window.localStorage.removeItem(SESSION_NAME_KEY)
  }

  const db = getFirestoreDb()
  if (db) {
    const sid = getSessionId()
    db.collection('conquest_analytics')
      .doc(`session_${sid}`)
      .set(
        {
          type: 'session',
          sessionId: sid,
          sessionName: cleaned,
          updated_at: Date.now(),
        },
        { merge: true }
      )
  }
  return cleaned
}

export function getCompletedMissions() {
  const raw = window.localStorage.getItem(COMPLETED_MISSIONS_KEY)
  if (!raw) return new Set()
  const arr = JSON.parse(raw)
  return new Set(Array.isArray(arr) ? arr.map(Number).filter(n => n === 1 || n === 2 || n === 3) : [])
}

export function markMissionCompleted(missionId) {
  const id = Number(missionId)
  if (id !== 1 && id !== 2 && id !== 3) return getCompletedMissions()
  const set = getCompletedMissions()
  set.add(id)
  window.localStorage.setItem(COMPLETED_MISSIONS_KEY, JSON.stringify([...set].sort()))
  return set
}

export function isTrainingCompleted() {
  const set = getCompletedMissions()
  return set.has(1) && set.has(2) && set.has(3)
}

export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10)
}

export function getReferrerHost() {
  if (!document.referrer) return 'direct'
  const url = new URL(document.referrer)
  return url.hostname || 'direct'
}

export function getDeviceType() {
  const ua = navigator.userAgent || ''
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua) || window.innerWidth < 768) {
    return 'mobile'
  }
  return 'desktop'
}

export function getFirestoreDb() {
  if (!window.firebase || !window.firebase.firestore) return null
  if (!window.firebase.apps.length) {
    window.firebase.initializeApp(FIREBASE_CONFIG)
  }
  return window.firebase.firestore()
}

export function trackEvent(eventName, meta = {}) {
  const db = getFirestoreDb()
  if (!db) return null

  const inc = window.firebase.firestore.FieldValue.increment(1)
  const now = Date.now()
  const today = getTodayDateString()
  const device = getDeviceType()
  const referrer = getReferrerHost()
  const sid = getSessionId()

  const aggregatePatch = {
    [eventName]: inc,
    updated_at: now,
  }

  if (eventName === 'page_load') {
    aggregatePatch.devices = { [device]: inc }
    aggregatePatch.referrers = { [referrer]: inc }
    aggregatePatch[`device_${device}`] = inc
  }

  const totalsPromise = db
    .collection('conquest_analytics')
    .doc('totals')
    .set(
      {
        type: 'totals',
        ...aggregatePatch,
      },
      { merge: true }
    )

  const dailyPromise = db
    .collection('conquest_analytics')
    .doc(`daily_${today}`)
    .set(
      {
        type: 'daily',
        date: today,
        ...aggregatePatch,
      },
      { merge: true }
    )

  const sName = getSessionName()
  const sessionPatch = {
    type: 'session',
    sessionId: sid,
    date: today,
    device,
    referrer,
    page: window.location.pathname,
    updated_at: now,
    counts: {
      [eventName]: inc,
    },
  }

  if (sName) {
    sessionPatch.sessionName = sName
  }

  if (eventName === 'page_load') {
    sessionPatch.started_at = now
  }

  if (eventName !== 'shots_fired') {
    sessionPatch.last_event = eventName
    sessionPatch.events = window.firebase.firestore.FieldValue.arrayUnion(eventName)
  }

  if (meta && Object.keys(meta).length > 0) {
    sessionPatch.last_meta = meta
  }

  const sessionPromise = db
    .collection('conquest_analytics')
    .doc(`session_${sid}`)
    .set(sessionPatch, { merge: true })

  return Promise.all([totalsPromise, dailyPromise, sessionPromise])
}

export function initAnalytics(mode = 'mission') {
  if (pageLoadTracked) return null
  pageLoadTracked = true
  return trackEvent('page_load', { mode })
}

export function trackMissionStart(missionId) {
  const id = Number(missionId)
  if (id === 1 || id === 2 || id === 3) {
    return trackEvent(`m${id}_start`, { missionId: id })
  }
  return null
}

export function trackMissionWin(missionId, extra = {}) {
  const id = Number(missionId)
  if (id === 1 || id === 2 || id === 3) {
    markMissionCompleted(id)
    return trackEvent(`m${id}_win`, { missionId: id, ...extra })
  }
  return null
}

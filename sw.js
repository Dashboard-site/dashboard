/* ============================================================
   Class Dashboard · Service Worker
   Firebase FCM (background) + offline cache + local schedule
   ============================================================ */

/* ---------- Firebase Cloud Messaging ---------- */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBsA4zUP0ubdO9DxM2ApLAN8PCdHFkdW0A",
  authDomain: "classdash-12c.firebaseapp.com",
  projectId: "classdash-12c",
  storageBucket: "classdash-12c.firebasestorage.app",
  messagingSenderId: "340499065450",
  appId: "1:340499065450:web:ba6096fc2b34fa34f2b813"
});

const fcmMessaging = firebase.messaging();

fcmMessaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "Class Dashboard";
  const body  = (payload.notification && payload.notification.body)  || "";
  self.registration.showNotification(title, {
    body,
    icon:  "./app-icon.png",
    badge: "./app-icon.png",
    data:  payload.data || {},
    tag:   (payload.data && payload.data.tag) || "classdash-fcm"
  });
});

/* ---------- Cache (install must not fail if one file 404s) ---------- */
const CACHE_NAME = "class12c-dashboard-v6";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./app-icon.png",
  "./icon.png",
  "./Ndot_font.woff2",
  "./bg1.png",
  "./bg2.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      for (const url of ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn("[SW] skip cache (missing?):", url);
        }
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/data/")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((res) => res || fetch(event.request))
  );
});

/* ---------- Notification click (single handler) ---------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

/* ---------- Local timetable schedule (page can still message SW) ---------- */
const NOTIF_SCHEDULE = [
  { time: "08:40", type: "period",    idx: 0,    prev: null,     prevLabel: null },
  { time: "09:40", type: "period",    idx: 1,    prev: "period", prevLabel: "Period 0" },
  { time: "10:20", type: "period",    idx: 2,    prev: "period", prevLabel: "Period 1" },
  { time: "11:00", type: "break",     idx: null, prev: "period", prevLabel: "Period 2", breakEnd: "11:10" },
  { time: "11:10", type: "period",    idx: 3,    prev: "break",  prevLabel: null },
  { time: "11:50", type: "period",    idx: 4,    prev: "period", prevLabel: "Period 3" },
  { time: "12:30", type: "lunch",     idx: null, prev: "period", prevLabel: "Period 4", breakEnd: "1:00 PM" },
  { time: "13:00", type: "period",    idx: 5,    prev: "lunch",  prevLabel: null },
  { time: "13:35", type: "period",    idx: 6,    prev: "period", prevLabel: "Period 5" },
  { time: "14:10", type: "break",     idx: null, prev: "period", prevLabel: "Period 6", breakEnd: "2:20 PM" },
  { time: "14:20", type: "period",    idx: 7,    prev: "break",  prevLabel: null },
  { time: "14:55", type: "period",    idx: 8,    prev: "period", prevLabel: "Period 7" },
  { time: "15:30", type: "period",    idx: 9,    prev: "period", prevLabel: "Period 8" },
  { time: "16:20", type: "dismissed", idx: null, prev: "period", prevLabel: "Period 9" }
];

let _timetable = null;
let _swTimers  = [];

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === "SCHEDULE_NOTIFICATIONS") {
    _timetable = msg.timetable;
    scheduleSWNotifications();
  }
  if (msg.type === "CANCEL_NOTIFICATIONS") {
    cancelSWTimers();
  }
});

function cancelSWTimers() {
  _swTimers.forEach((t) => clearTimeout(t));
  _swTimers = [];
}

function scheduleSWNotifications() {
  cancelSWTimers();
  const now = Date.now();
  const d = new Date();
  const todayBase = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  NOTIF_SCHEDULE.forEach((entry) => {
    const [h, m] = entry.time.split(":").map(Number);
    const fireAt = todayBase + h * 3600000 + m * 60000;
    const delay = fireAt - now;
    if (delay > 0) {
      _swTimers.push(setTimeout(() => swShowNotification(entry), delay));
    }
  });

  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 5).getTime();
  _swTimers.push(
    setTimeout(() => {
      if (_timetable) scheduleSWNotifications();
    }, tomorrow - now)
  );
}

function buildContent(entry) {
  const day = new Date().getDay();
  const tt = (_timetable && _timetable[day]) || [];
  let title = "";
  let body = "";

  if (entry.type === "period") {
    const p = tt[entry.idx];
    const sub = (p && p.subject) || "—";
    const teach = (p && p.teacher) || "—";
    title = "📚 Period " + entry.idx;
    const pre =
      entry.prev === "period" ? entry.prevLabel + " over · " :
      entry.prev === "break"  ? "Break over · " :
      entry.prev === "lunch"  ? "Lunch over · " : "";
    body = pre + sub + " · " + teach;
  } else if (entry.type === "break") {
    title = "☕ Break Time";
    body = entry.prevLabel + " over · Break until " + entry.breakEnd;
  } else if (entry.type === "lunch") {
    title = "🍽️ Lunch Break";
    body = entry.prevLabel + " over · Lunch until " + entry.breakEnd;
  } else if (entry.type === "dismissed") {
    title = "🏁 School Dismissed";
    body = entry.prevLabel + " over · See you tomorrow!";
  }
  return { title, body };
}

function swShowNotification(entry) {
  const { title, body } = buildContent(entry);
  self.registration.showNotification(title, {
    body,
    icon: "./app-icon.png",
    badge: "./app-icon.png",
    tag: "period-" + entry.time,
    renotify: true
  });
}

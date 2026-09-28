import { APP_CONFIG } from "./config.js";
import { setMapsAppCheckTokenProvider, TripStore } from "./services.js";

const FIREBASE_VERSION = "12.19.0";

function sortedTrips(trips) {
  return trips.sort((first, second) => (second.updatedAt ?? "").localeCompare(first.updatedAt ?? ""));
}

export class TripSync {
  constructor(localStore, onChange, onStatus) {
    this.localStore = localStore;
    this.currentStore = localStore;
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.remoteTrips = [];
    this.user = null;
    this.unsubscribe = null;
    this.firebase = null;
    this.pendingWrites = new Map();
    this.authRevision = 0;
    this.retryPromise = null;
  }

  get configured() {
    const config = globalThis.ROAMLY_CONFIG?.firebase;
    return Boolean(config?.apiKey && config?.authDomain && config?.projectId && config?.appId);
  }

  async start() {
    if (!this.configured) {
      this.onStatus({ mode: "local" });
      return;
    }
    try {
      const appCheckSiteKey = globalThis.ROAMLY_CONFIG?.mapsAppCheckSiteKey?.trim();
      const [appModule, authModule, firestoreModule, appCheckModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
        appCheckSiteKey ? import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-check.js`) : null,
      ]);
      const app = appModule.initializeApp(globalThis.ROAMLY_CONFIG.firebase);
      if (appCheckModule) {
        const appCheck = appCheckModule.initializeAppCheck(app, {
          provider: new appCheckModule.ReCaptchaEnterpriseProvider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
        if (globalThis.ROAMLY_CONFIG?.mapsAppCheckRequired) {
          await appCheckModule.getToken(appCheck, false);
        }
        await setMapsAppCheckTokenProvider(() => appCheckModule.getToken(appCheck, false));
      }
      const auth = authModule.getAuth(app);
      const db = firestoreModule.getFirestore(app);
      this.firebase = { auth, db, authModule, firestoreModule };
      window.addEventListener("online", () => { this.retrySync(); });
      await new Promise((resolve) => {
        authModule.onAuthStateChanged(auth, async (user) => {
          try {
            await this.handleAuthChange(user);
          } catch (error) {
            console.error({ error }, "Không thể khởi tạo đồng bộ chuyến đi");
            this.onStatus({ mode: "error", user });
          } finally {
            resolve();
          }
        }, (error) => {
          console.error({ error }, "Không thể xác định tài khoản");
          this.onStatus({ mode: "error" });
          resolve();
        });
      });
    } catch (error) {
      console.error({ error }, "Không thể tải dịch vụ đồng bộ");
      this.onStatus({ mode: "error" });
    }
  }

  async handleAuthChange(user) {
    const revision = ++this.authRevision;
    const sameUser = Boolean(user && this.user?.uid === user.uid);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.user = user;
    if (!sameUser) this.remoteTrips = [];
    this.currentStore = user
      ? new TripStore(`${APP_CONFIG.tripsStorageKey}.${user.uid}`, null)
      : this.localStore;
    this.onChange();
    if (!user) {
      this.onStatus({ mode: "signed-out" });
      return;
    }
    this.onStatus({ mode: "syncing", user });
    const { db, firestoreModule: firestore } = this.firebase;
    const trips = firestore.collection(db, "users", user.uid, "trips");
    const existing = await firestore.getDocs(trips);
    if (revision !== this.authRevision) return;
    const existingById = new Map(existing.docs.map((snapshot) => [snapshot.id, snapshot.data().trip]));
    const pendingTrips = new Map([...this.localStore.list(), ...this.currentStore.list()].map((trip) => [trip.id, trip]));
    for (const localTrip of pendingTrips.values()) {
      if (revision !== this.authRevision) return;
      const remoteTrip = existingById.get(localTrip.id);
      if (!remoteTrip || (localTrip.updatedAt ?? "") > (remoteTrip.updatedAt ?? "")) {
        await firestore.setDoc(firestore.doc(trips, localTrip.id), { trip: localTrip });
      }
    }
    if (revision !== this.authRevision) return;
    this.localStore.clear();
    this.currentStore.clear();
    this.unsubscribe = firestore.onSnapshot(trips, (snapshot) => {
      if (this.user?.uid !== user.uid) return;
      this.remoteTrips = sortedTrips(snapshot.docs.map((document) => document.data().trip)
        .filter((trip) => trip && typeof trip.id === "string" && trip.id));
      this.onChange();
      this.onStatus({ mode: this.currentStore.list().length ? "pending" : "synced", user });
    }, (error) => {
      console.error({ error }, "Không thể theo dõi chuyến đi");
      this.onStatus({ mode: "error", user });
    });
  }

  retrySync() {
    if (!this.user || this.retryPromise) return this.retryPromise;
    this.retryPromise = this.handleAuthChange(this.user).catch((error) => {
      console.error({ error }, "Không thể kết nối lại đồng bộ chuyến đi");
      this.onStatus({ mode: "error", user: this.user });
    }).finally(() => { this.retryPromise = null; });
    return this.retryPromise;
  }

  list() {
    if (!this.user) return this.localStore.list();
    const trips = new Map(this.remoteTrips.map((trip) => [trip.id, trip]));
    this.currentStore.list().forEach((trip) => trips.set(trip.id, trip));
    return sortedTrips([...trips.values()]);
  }

  load(id) {
    return this.list().find((trip) => trip.id === id) ?? null;
  }

  async save(trip) {
    const activeStore = this.currentStore;
    if (!this.user) {
      if (!activeStore.save(trip)) throw new Error("LOCAL_SAVE_FAILED");
      this.onChange();
      return "local";
    }
    if (!activeStore.save(trip)) throw new Error("LOCAL_SAVE_FAILED");
    this.onChange();
    const { db, firestoreModule: firestore } = this.firebase;
    const userId = this.user.uid;
    const tripId = trip.id;
    const writeKey = `${userId}/${tripId}`;
    const document = firestore.doc(db, "users", userId, "trips", tripId);
    const previous = this.pendingWrites.get(writeKey) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(() => firestore.setDoc(document, { trip: JSON.parse(JSON.stringify(trip)) }));
    this.pendingWrites.set(writeKey, write);
    try {
      await write;
      if (this.pendingWrites.get(writeKey) === write) {
        this.pendingWrites.delete(writeKey);
        activeStore.remove(tripId);
        if (this.user?.uid === userId) {
          this.onChange();
          this.onStatus({ mode: this.currentStore.list().length ? "pending" : "synced", user: this.user });
        }
      }
      return "synced";
    } catch (error) {
      if (this.pendingWrites.get(writeKey) === write) this.pendingWrites.delete(writeKey);
      console.error({ error, tripId }, "Không thể đồng bộ chuyến đi");
      if (this.user?.uid === userId) this.onStatus({ mode: "pending", user: this.user });
      throw error;
    }
  }

  async signIn() {
    if (!this.firebase) throw new Error("SYNC_UNAVAILABLE");
    const { auth, authModule } = this.firebase;
    await authModule.signInWithPopup(auth, new authModule.GoogleAuthProvider());
  }

  async signOut() {
    if (!this.firebase) return;
    await this.firebase.authModule.signOut(this.firebase.auth);
  }
}

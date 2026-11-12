import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

// Blueprint-synchronized validation helpers & limits
const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const VALID_SUBJECTS = new Set(['MATH', 'SCIENCE', 'CODING', 'HISTORY', 'MIXED']);

function sanitizeId(value: string, fallback: string, maxLen = 32): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, maxLen);
  return cleaned && ID_PATTERN.test(cleaned) ? cleaned : fallback;
}

function sanitizeText(value: string, fallback: string, maxLen: number): string {
  const cleaned = String(value || '').trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

export interface UserProgressData {
  uid: string;
  displayName: string;
  bestCredits: number;
  bestMilestone: string;
  selectedOutfit: string;
  selectedHeadwear: string;
  selectedBack: string;
  unlockedItems: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LeaderboardRecord {
  id: string;
  uid: string;
  playerName: string;
  credits: number;
  milestone: string;
  tasksSolved: number;
  subject: string;
  outfit: string;
}

export async function signInWithGooglePopup(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function loadUserProgress(uid: string): Promise<UserProgressData | null> {
  const safeUid = sanitizeId(uid, '', 128);
  if (!safeUid) return null;
  const path = `users/${safeUid}`;
  try {
    const snap = await getDoc(doc(db, 'users', safeUid));
    if (!snap.exists()) return null;
    return snap.data() as UserProgressData;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserProgress(
  uid: string,
  payload: {
    displayName: string;
    bestCredits: number;
    bestMilestone: string;
    selectedOutfit: string;
    selectedHeadwear: string;
    selectedBack: string;
    unlockedItems: string[];
  }
): Promise<UserProgressData | null> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
  if (!auth.currentUser.emailVerified) return null;

  const safeUid = sanitizeId(uid, '', 128);
  if (!safeUid) return null;

  const path = `users/${safeUid}`;
  const docRef = doc(db, 'users', safeUid);

  const sanitizedItems = Array.from(
    new Set(
      (payload.unlockedItems || ['hoodie'])
        .map((id) => sanitizeId(id, '', 32))
        .filter(Boolean)
    )
  ).slice(0, 30);
  if (sanitizedItems.length === 0) sanitizedItems.push('hoodie');

  const safeDisplayName = sanitizeText(payload.displayName, 'Campus Runner', 60);
  const safeMilestone = sanitizeText(payload.bestMilestone, 'Orientation Week', 60);
  const safeOutfit = sanitizeId(payload.selectedOutfit, 'hoodie', 32);
  const safeHeadwear = sanitizeId(payload.selectedHeadwear, 'cap', 32);
  const safeBack = sanitizeId(payload.selectedBack, 'backpack', 32);
  const safeCredits = clampInt(payload.bestCredits, 0, 100000000);

  let existingSnap;
  try {
    existingSnap = await getDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!existingSnap.exists()) {
    try {
      await setDoc(docRef, {
        uid: safeUid,
        displayName: safeDisplayName,
        bestCredits: safeCredits,
        bestMilestone: safeMilestone,
        selectedOutfit: safeOutfit,
        selectedHeadwear: safeHeadwear,
        selectedBack: safeBack,
        unlockedItems: sanitizedItems,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    const existingData = existingSnap.data() as UserProgressData;
    const mergedCredits = Math.max(safeCredits, clampInt(existingData.bestCredits || 0, 0, 100000000));
    const mergedUnlocked = Array.from(
      new Set([
        ...(Array.isArray(existingData.unlockedItems) ? existingData.unlockedItems : []),
        ...sanitizedItems
      ])
    )
      .map((id) => sanitizeId(id, '', 32))
      .filter(Boolean)
      .slice(0, 30);
    if (mergedUnlocked.length === 0) mergedUnlocked.push('hoodie');

    const finalMilestone =
      mergedCredits > clampInt(existingData.bestCredits || 0, 0, 100000000)
        ? safeMilestone
        : sanitizeText(existingData.bestMilestone, safeMilestone, 60);

    try {
      await updateDoc(docRef, {
        displayName: safeDisplayName,
        bestCredits: mergedCredits,
        bestMilestone: finalMilestone,
        selectedOutfit: safeOutfit,
        selectedHeadwear: safeHeadwear,
        selectedBack: safeBack,
        unlockedItems: mergedUnlocked,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  return loadUserProgress(safeUid);
}

export async function submitLeaderboardEntry(entry: {
  playerName: string;
  credits: number;
  milestone: string;
  tasksSolved: number;
  subject: string;
  outfit: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const entryId = `${sanitizeId(user.uid, 'runner', 40)}_${Date.now()}`;
  const path = `leaderboard/${entryId}`;
  const upperSubject = String(entry.subject || 'MIXED').toUpperCase();
  const safeSubject = VALID_SUBJECTS.has(upperSubject) ? upperSubject : 'MIXED';

  try {
    await setDoc(doc(db, 'leaderboard', entryId), {
      uid: user.uid,
      playerName: sanitizeText(entry.playerName, 'Campus Runner', 40),
      credits: clampInt(entry.credits, 0, 100000000),
      milestone: sanitizeText(entry.milestone, 'Orientation Week', 60),
      tasksSolved: clampInt(entry.tasksSolved, 0, 10000),
      subject: safeSubject,
      outfit: sanitizeId(entry.outfit, 'hoodie', 32),
      createdAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function fetchGlobalLeaderboard(maxEntries = 10): Promise<LeaderboardRecord[]> {
  const path = 'leaderboard';
  try {
    const safeLimit = Math.max(1, Math.min(25, Math.floor(maxEntries)));
    const q = query(
      collection(db, 'leaderboard'),
      where('credits', '>=', 0),
      orderBy('credits', 'desc'),
      limit(safeLimit)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        uid: String(data.uid || ''),
        playerName: String(data.playerName || 'Runner'),
        credits: Number(data.credits || 0),
        milestone: String(data.milestone || 'Orientation Week'),
        tasksSolved: Number(data.tasksSolved || 0),
        subject: String(data.subject || 'MIXED'),
        outfit: String(data.outfit || 'hoodie')
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

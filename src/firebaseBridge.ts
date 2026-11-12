import {
  fetchGlobalLeaderboard,
  loadUserProgress,
  saveUserProgress,
  signInWithGooglePopup,
  signOutUser,
  submitLeaderboardEntry,
  subscribeToAuth,
  type LeaderboardRecord,
  type UserProgressData
} from './firebase.ts';

export interface CloudSyncState {
  uid: string;
  displayName: string;
  photoURL: string | null;
  progress: UserProgressData | null;
}

declare global {
  interface Window {
    SoftpearFirebase?: {
      isSignedIn: () => boolean;
      getUser: () => { uid: string; displayName: string; photoURL: string | null } | null;
      signIn: () => Promise<void>;
      signOut: () => Promise<void>;
      syncProgress: (payload: {
        bestCredits: number;
        bestMilestone: string;
        selectedOutfit: string;
        selectedHeadwear: string;
        selectedBack: string;
        unlockedItems: string[];
      }) => Promise<UserProgressData | null>;
      submitRun: (entry: {
        credits: number;
        milestone: string;
        tasksSolved: number;
        subject: string;
        outfit: string;
      }) => Promise<void>;
      refreshLeaderboard: () => Promise<LeaderboardRecord[]>;
    };
  }
}

let currentUser: { uid: string; displayName: string; photoURL: string | null } | null = null;

function dispatch(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function refreshLeaderboard(): Promise<LeaderboardRecord[]> {
  try {
    const entries = await fetchGlobalLeaderboard(25);
    dispatch('softpear:leaderboard-updated', entries);
    return entries;
  } catch {
    return [];
  }
}

subscribeToAuth(async (user) => {
  if (user) {
    currentUser = {
      uid: user.uid,
      displayName: user.displayName || 'Campus Runner',
      photoURL: user.photoURL
    };
    dispatch('softpear:auth-changed', currentUser);
    try {
      const progress = await loadUserProgress(user.uid);
      dispatch('softpear:cloud-progress', progress);
    } catch {
      // Handled by handleFirestoreError logging
    }
  } else {
    currentUser = null;
    dispatch('softpear:auth-changed', null);
  }
  void refreshLeaderboard();
});

window.SoftpearFirebase = {
  isSignedIn: () => Boolean(currentUser),
  getUser: () => currentUser,
  signIn: async () => {
    await signInWithGooglePopup();
  },
  signOut: async () => {
    await signOutUser();
  },
  syncProgress: async (payload) => {
    if (!currentUser) return null;
    try {
      const saved = await saveUserProgress(currentUser.uid, {
        displayName: currentUser.displayName,
        ...payload
      });
      if (saved) dispatch('softpear:cloud-progress', saved);
      return saved;
    } catch {
      return null;
    }
  },
  submitRun: async (entry) => {
    if (!currentUser) return;
    try {
      await submitLeaderboardEntry({
        playerName: currentUser.displayName,
        ...entry
      });
      await refreshLeaderboard();
    } catch {
      // Handled by handleFirestoreError logging
    }
  },
  refreshLeaderboard
};

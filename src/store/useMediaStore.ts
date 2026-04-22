import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';

export interface PendingAsset {
  id: string;
  uri: string;
  mediaType: MediaLibrary.MediaTypeValue;
  width: number;
  height: number;
  duration: number; // for videos
}

interface ActionHistory {
  type: 'KEEP' | 'DELETE';
  asset: PendingAsset;
}

interface MediaState {
  keptItems: Record<string, boolean>; // id -> true
  pendingDeletion: PendingAsset[];
  totalSpaceSavedBytes: number;
  lastAction: ActionHistory | null;
  
  // Ephemeral State
  allAssets: MediaLibrary.Asset[];
  isFetchingMedia: boolean;
  mediaFetchProgress: { loaded: number; total: number };
  
  // Actions
  setAllAssets: (assets: MediaLibrary.Asset[]) => void;
  setFetchingMedia: (isFetching: boolean) => void;
  setMediaFetchProgress: (loaded: number, total: number) => void;
  keepItem: (asset: PendingAsset) => void;
  markForDeletion: (asset: PendingAsset) => void;
  undoLastAction: () => void;
  confirmDeletion: (deletedIds: string[]) => void;
  incrementSpaceSaved: (bytes: number) => void;
  restoreItem: (id: string) => void; // move from pending
  clearProgress: () => void; // debug
}

export const useMediaStore = create<MediaState>()(
  persist(
    (set) => ({
      keptItems: {},
      pendingDeletion: [],
      totalSpaceSavedBytes: 0,
      lastAction: null,
      allAssets: [],
      isFetchingMedia: false,
      mediaFetchProgress: { loaded: 0, total: 0 },

      setAllAssets: (assets) => set({ allAssets: assets }),
      setFetchingMedia: (isFetching) => set({ isFetchingMedia: isFetching }),
      setMediaFetchProgress: (loaded, total) => set({ mediaFetchProgress: { loaded, total } }),

      keepItem: (asset) => set((state) => ({
        keptItems: { ...state.keptItems, [asset.id]: true },
        pendingDeletion: state.pendingDeletion.filter(a => a.id !== asset.id),
        lastAction: { type: 'KEEP', asset }
      })),

      markForDeletion: (asset) => set((state) => {
        const newKept = { ...state.keptItems };
        delete newKept[asset.id];
        return {
          pendingDeletion: [...state.pendingDeletion.filter(a => a.id !== asset.id), asset],
          keptItems: newKept,
          lastAction: { type: 'DELETE', asset }
        };
      }),

      undoLastAction: () => set((state) => {
        if (!state.lastAction) return state;

        const { type, asset } = state.lastAction;
        if (type === 'KEEP') {
          const newKept = { ...state.keptItems };
          delete newKept[asset.id];
          return { keptItems: newKept, lastAction: null };
        } else if (type === 'DELETE') {
          return {
            pendingDeletion: state.pendingDeletion.filter(a => a.id !== asset.id),
            lastAction: null
          };
        }
        return state;
      }),

      confirmDeletion: (deletedIds) => set((state) => {
        const deletedSet = new Set(deletedIds);
        // Remove from pending 
        const remainingPending = state.pendingDeletion.filter(a => !deletedSet.has(a.id));
        
        // Also remove from lastAction if it was the last action deleted
        let newLastAction = state.lastAction;
        if (state.lastAction && deletedSet.has(state.lastAction.asset.id)) {
          newLastAction = null;
        }

        return {
          pendingDeletion: remainingPending,
          lastAction: newLastAction
        };
      }),

      incrementSpaceSaved: (bytes) => set((state) => ({
        totalSpaceSavedBytes: state.totalSpaceSavedBytes + bytes
      })),

      restoreItem: (id) => set((state) => ({
        pendingDeletion: state.pendingDeletion.filter(a => a.id !== id),
        // optionally log lastAction here as null or handle undo
      })),

      clearProgress: () => set({
        keptItems: {},
        pendingDeletion: [],
        totalSpaceSavedBytes: 0,
        lastAction: null
      })
    }),
    {
      name: 'memory-flick-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        keptItems: state.keptItems,
        pendingDeletion: state.pendingDeletion,
        totalSpaceSavedBytes: state.totalSpaceSavedBytes,
        lastAction: state.lastAction,
      }),
    }
  )
);

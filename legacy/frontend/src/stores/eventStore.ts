import { create } from 'zustand';
import type { AIEvent } from '../types';

interface EventStore {
  liveEvents: AIEvent[];
  addEvent: (event: AIEvent) => void;
  clearEvents: () => void;
}

export const useEventStore = create<EventStore>((set) => ({
  liveEvents: [],
  addEvent: (event) => set((state) => ({ 
    liveEvents: [event, ...state.liveEvents].slice(0, 50) 
  })),
  clearEvents: () => set({ liveEvents: [] }),
}));

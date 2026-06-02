import { create } from 'zustand';

// Each word lives in one of five visual states.
//   Pending      — default; not yet recited (dark grey)
//   Correct      — locked & matched expected on first try (green)
//   Mistake      — flagged via partial_mistake (red)
//   Corrected    — user re-read a flagged word correctly (green)
//   Acknowledged — flagged word the user moved past (faded red)
export const WordState = {
  Pending: 'pending',
  Correct: 'correct',
  Mistake: 'mistake',
  Corrected: 'corrected',
  Acknowledged: 'acknowledged',
};

export const useWordStateStore = create((set, get) => ({
  // Shape: { [ayahNum]: { [wordIdx]: WordState } }
  states: {},

  setState: (ayah, wordIdx, state) =>
    set((prev) => ({
      states: {
        ...prev.states,
        [ayah]: { ...(prev.states[ayah] || {}), [wordIdx]: state },
      },
    })),

  reset: () => set({ states: {} }),

  get: (ayah, wordIdx) =>
    (get().states[ayah] || {})[wordIdx] || WordState.Pending,
}));

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NOTE: the React Compiler preset is intentionally NOT enabled. The game
// state is a single large object mutated in place (with a version counter in
// the zustand store driving re-renders); the compiler's identity-based
// memoization assumes immutable data and serves stale UI under that pattern.
// Don't re-add babel-plugin-react-compiler without first making game-state
// updates immutable (e.g. via immer).
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/soccer-manager/' : '/',
  plugins: [react()],
})

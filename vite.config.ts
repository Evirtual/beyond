import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // the workspace lives under a virtualized Windows app-data path; resolving
  // real paths points Vite at a location it can't read
  resolve: { preserveSymlinks: true },
  server: { port: 5199 },
})

export default {
  launch: {
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  },
  server: {
    command: 'npm run dev',
    port: 5173,
    launchTimeout: 15000,
  },
}

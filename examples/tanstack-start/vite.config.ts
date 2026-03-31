import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    {
      name: 'slop-adapter',
      configureServer(server) {
        server.httpServer?.once('listening', async () => {
          const { slop } = await server.ssrLoadModule('./src/server/slop.ts') as any
          const { createWebSocketHandler } = await server.ssrLoadModule('@slop-ai/tanstack-start/server') as any
          const ws = await import('ws')

          const handler = createWebSocketHandler({ resolve: () => slop })
          const wss = new ws.WebSocketServer({ noServer: true })

          server.httpServer!.on('upgrade', (req: any, socket: any, head: any) => {
            const url = new URL(req.url!, `http://${req.headers.host}`)
            if (url.pathname === '/slop') {
              wss.handleUpgrade(req, socket, head, (wsConn: any) => {
                const peer = {
                  send: (data: string) => { if (wsConn.readyState === 1) wsConn.send(data) },
                  close: () => wsConn.close(),
                  __slopRequest: req,
                  __slop: null as any,
                }
                handler.open(peer)
                wsConn.on('message', (data: any) => {
                  handler.message(peer, { text: () => data.toString(), toString: () => data.toString() })
                })
                wsConn.on('close', () => handler.close(peer))
              })
            }
          })

          console.log('[slop] WebSocket adapter ready at /slop')
        })
      },
    },
  ],
})

export default config

import { defineConfig } from 'vite'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { SlopServer } from '@slop-ai/server'
import { WebSocket, WebSocketServer } from 'ws'

interface SlopModule {
  slop: SlopServer
}

interface SlopPeer {
  send(data: string): void
  close(): void
  __slopRequest: IncomingMessage
}

interface SlopPeerMessage {
  text(): string
  toString(): string
}

interface SlopWebSocketHandler {
  open(peer: SlopPeer): void
  message(peer: SlopPeer, message: SlopPeerMessage): void
  close(peer: SlopPeer): void
}

interface TanstackStartServerModule {
  createWebSocketHandler(options: {
    resolve: () => SlopServer | Promise<SlopServer>
    uiMountPath?: string
  }): SlopWebSocketHandler
}

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
        const httpServer = server.httpServer
        if (!httpServer) return

        httpServer.once('listening', async () => {
          const slopModule = await server.ssrLoadModule('./src/server/slop.ts')
          const tanstackModule = await server.ssrLoadModule('@slop-ai/tanstack-start/server')
          if (!isSlopModule(slopModule) || !isTanstackStartServerModule(tanstackModule)) {
            throw new Error('[slop] failed to load TanStack Start SLOP modules')
          }

          const handler = tanstackModule.createWebSocketHandler({ resolve: () => slopModule.slop })
          const wss = new WebSocketServer({ noServer: true })

          httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
            if (!req.url) return
            const url = new URL(req.url, `http://${req.headers.host}`)
            if (url.pathname === '/slop') {
              wss.handleUpgrade(req, socket, head, (wsConn: WebSocket) => {
                const peer = {
                  send: (data: string) => { if (wsConn.readyState === WebSocket.OPEN) wsConn.send(data) },
                  close: () => wsConn.close(),
                  __slopRequest: req,
                }
                handler.open(peer)
                wsConn.on('message', (data) => {
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

function isSlopModule(value: unknown): value is SlopModule {
  return !!value
    && typeof value === 'object'
    && 'slop' in value
}

function isTanstackStartServerModule(value: unknown): value is TanstackStartServerModule {
  return !!value
    && typeof value === 'object'
    && typeof (value as { createWebSocketHandler?: unknown }).createWebSocketHandler === 'function'
}

import { useEffect, useRef, useState } from 'react'

export function useWebSocket({ token, onMessage }) {
  const wsRef = useRef(null)
  const retryTimerRef = useRef(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token) return undefined

    let shouldReconnect = true
    const wsBase = import.meta.env.VITE_WS_BASE_URL

    const connect = () => {
      const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data)
          onMessage(parsed)
        } catch {
          // Ignore non-JSON messages in MVP mode.
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (shouldReconnect) {
          retryTimerRef.current = window.setTimeout(connect, 1500)
        }
      }
      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      shouldReconnect = false
      setConnected(false)
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
      if (wsRef.current && wsRef.current.readyState < 2) wsRef.current.close()
    }
  }, [token, onMessage])

  const sendJson = (payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload))
      return true
    }
    return false
  }

  return { connected, sendJson }
}


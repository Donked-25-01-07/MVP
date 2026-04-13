import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Message from './components/Message'
import { useWebSocket } from './hooks/useWebSocket'
import { defaultThemeKey, themes } from './theme'

function Chat({ auth, onLogout }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [themeKey, setThemeKey] = useState(defaultThemeKey)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const endRef = useRef(null)

  const activeTheme = themes[themeKey]

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const { connected, sendJson } = useWebSocket({
    token: auth.token,
    onMessage: appendMessage,
  })

  useEffect(() => {
    const loadHistory = async () => {
      setLoadingHistory(true)
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/messages`)
        if (!response.ok) throw new Error('Failed to load history')
        const data = await response.json()
        setMessages(data)
      } finally {
        setLoadingHistory(false)
      }
    }
    loadHistory()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = (event) => {
    event.preventDefault()
    const normalized = text.trim()
    if (!normalized) return

    const ok = sendJson({ message: normalized })
    if (ok) setText('')
  }

  const themeVars = useMemo(
    () => ({
      '--bg': activeTheme.bg,
      '--panel': activeTheme.panel,
      '--panel-alt': activeTheme.panelAlt,
      '--text': activeTheme.text,
      '--muted': activeTheme.muted,
      '--accent': activeTheme.accent,
      '--accent-hover': activeTheme.accentHover,
      '--input': activeTheme.input,
      '--bubble-self': activeTheme.bubbleSelf,
      '--bubble-other': activeTheme.bubbleOther,
    }),
    [activeTheme],
  )

  return (
    <div className="layout" style={themeVars}>
      <aside className="left-pane">
        <div className="brand">Verdgram</div>
        <div className="user-card">
          <div>
            <div className="username">{auth.username}</div>
            <div className="status">{connected ? 'Connected' : 'Reconnecting...'}</div>
          </div>
          <button onClick={onLogout}>Logout</button>
        </div>
        <label className="theme-label">
          Theme
          <select value={themeKey} onChange={(e) => setThemeKey(e.target.value)}>
            {Object.entries(themes).map(([key, theme]) => (
              <option key={key} value={key}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>
      </aside>
      <section className="chat-pane">
        <header># general</header>
        <div className="messages">
          {loadingHistory ? <div className="loading">Loading history...</div> : null}
          {messages.map((item) => (
            <Message key={item.id} item={item} own={item.sender === auth.username} />
          ))}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message #general"
            maxLength={4000}
          />
          <button type="submit" disabled={!connected}>
            Send
          </button>
        </form>
      </section>
    </div>
  )
}

export default Chat

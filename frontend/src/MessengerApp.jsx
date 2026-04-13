import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import Message from './components/Message'
import { useWebSocket } from './hooks/useWebSocket'
import { defaultThemeKey, themes } from './theme'

function MessengerApp({ auth, onLogout }) {
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [typingUsers, setTypingUsers] = useState([])
  const [query, setQuery] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [selectedMembers, setSelectedMembers] = useState([])
  const [messageText, setMessageText] = useState('')
  const [themeKey, setThemeKey] = useState(localStorage.getItem('themeKey') || defaultThemeKey)
  const [notificationCount, setNotificationCount] = useState(0)
  const [attachment, setAttachment] = useState(null)
  const endRef = useRef(null)

  const theme = themes[themeKey]

  const authRequest = useCallback((path, options = {}) => api(path, { token: auth.token, ...options }), [auth.token])

  const loadConversations = useCallback(async () => {
    const data = await authRequest('/conversations')
    setConversations(data)
    if (!activeConversation && data.length > 0) setActiveConversation(data[0])
  }, [activeConversation, authRequest])

  useEffect(() => {
    const bootstrap = async () => {
      const [meRow, convRows, userRows, unreadRow] = await Promise.all([
        authRequest('/me'),
        authRequest('/conversations'),
        authRequest(`/users?q=${encodeURIComponent(query)}`),
        authRequest('/notifications/unread-count'),
      ])
      setMe(meRow)
      setConversations(convRows)
      setUsers(userRows)
      setNotificationCount(unreadRow.unread_count)
      if (!activeConversation && convRows.length > 0) {
        setActiveConversation(convRows[0])
      }
    }
    bootstrap()
  }, [activeConversation, authRequest, query])

  useEffect(() => {
    const bootstrapMessages = async () => {
      if (!activeConversation?.id) return
      const data = await authRequest(`/conversations/${activeConversation.id}/messages`)
      setMessages(data)
    }
    bootstrapMessages()
  }, [activeConversation?.id, authRequest])

  useEffect(() => {
    localStorage.setItem('themeKey', themeKey)
  }, [themeKey])

  const onSocketEvent = useCallback(
    (payload) => {
      const { event, data } = payload || {}
      if (!event) return

      if (event === 'message:new') {
        setMessages((prev) => {
          if (!activeConversation || data.conversation_id !== activeConversation.id) return prev
          if (prev.some((msg) => msg.id === data.id)) return prev
          return [...prev, data]
        })
        loadConversations()
      }

      if (event === 'typing:start' && data?.conversation_id === activeConversation?.id) {
        setTypingUsers((prev) => [...new Set([...prev, data.username || String(data.user_id)])])
      }
      if (event === 'typing:stop' && data?.conversation_id === activeConversation?.id) {
        setTypingUsers((prev) => prev.filter((name) => name !== (data.username || String(data.user_id))))
      }
    },
    [activeConversation, loadConversations],
  )

  const { connected, sendEvent } = useWebSocket({ token: auth.token, onEvent: onSocketEvent })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typingUsers])

  const createDm = async (username) => {
    const conv = await authRequest('/conversations/dm', {
      method: 'POST',
      body: { username },
    })
    await loadConversations()
    setActiveConversation(conv)
  }

  const createGroup = async () => {
    if (!newGroupTitle.trim()) return
    const conv = await authRequest('/conversations/group', {
      method: 'POST',
      body: {
        title: newGroupTitle.trim(),
        member_ids: selectedMembers,
      },
    })
    setNewGroupTitle('')
    setSelectedMembers([])
    await loadConversations()
    setActiveConversation(conv)
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    if (!activeConversation?.id) return
    const text = messageText.trim()
    if (!text && !attachment) return

    let payload = { content: text || '[attachment]' }
    if (attachment) {
      const form = new FormData()
      form.append('file', attachment)
      const upload = await authRequest('/attachments', {
        method: 'POST',
        body: form,
        isForm: true,
      })
      payload = { ...payload, attachment_url: upload.url, attachment_name: upload.name }
    }

    if (text && connected) {
      const sent = sendEvent('message:new', {
        conversation_id: activeConversation.id,
        content: text,
      })
      if (!sent || attachment) {
        const created = await authRequest(`/conversations/${activeConversation.id}/messages`, {
          method: 'POST',
          body: payload,
        })
        setMessages((prev) => [...prev, created])
      }
    } else {
      const created = await authRequest(`/conversations/${activeConversation.id}/messages`, {
        method: 'POST',
        body: payload,
      })
      setMessages((prev) => [...prev, created])
    }

    setAttachment(null)
    setMessageText('')
    await loadConversations()
  }

  const editMessage = async (messageId, content) => {
    const updated = await authRequest(`/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    })
    setMessages((prev) => prev.map((msg) => (msg.id === updated.id ? updated : msg)))
  }

  const deleteMessage = async (messageId) => {
    await authRequest(`/messages/${messageId}`, { method: 'DELETE' })
    setMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, content: '[deleted]', deleted_at: new Date().toISOString() } : msg)),
    )
  }

  const onTyping = (value) => {
    setMessageText(value)
    if (!activeConversation?.id) return
    sendEvent(value ? 'typing:start' : 'typing:stop', { conversation_id: activeConversation.id })
  }

  const applyTheme = useMemo(
    () => ({
      '--bg': theme.bg,
      '--panel': theme.panel,
      '--panel-alt': theme.panelAlt,
      '--text': theme.text,
      '--muted': theme.muted,
      '--accent': theme.accent,
      '--accent-hover': theme.accentHover,
      '--input': theme.input,
      '--bubble-self': theme.bubbleSelf,
      '--bubble-other': theme.bubbleOther,
      '--border': theme.border,
      '--card': theme.card,
      '--success': theme.success,
      '--danger': theme.danger,
    }),
    [theme],
  )

  return (
    <div className="app-shell" style={applyTheme}>
      <aside className="sidebar-left">
        <div className="brand">Verdgram Pro</div>
        <div className="user-pill">
          <div>
            <strong>{me?.username || auth.username}</strong>
            <p>{connected ? 'online' : 'reconnecting'}</p>
          </div>
          <button onClick={onLogout}>Logout</button>
        </div>
        <div className="section-title">Theme</div>
        <select value={themeKey} onChange={(e) => setThemeKey(e.target.value)}>
          {Object.entries(themes).map(([key, value]) => (
            <option key={key} value={key}>
              {value.name}
            </option>
          ))}
        </select>
        <div className="section-title">Notifications</div>
        <div className="badge">{notificationCount} unread</div>
        <div className="section-title">Start DM</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users" />
        <div className="list">
          {users.map((user) => (
            <button key={user.id} className="list-item" onClick={() => createDm(user.username)}>
              <span>{user.username}</span>
              <small>{user.status}</small>
            </button>
          ))}
        </div>
        <div className="section-title">Create Group</div>
        <input value={newGroupTitle} onChange={(e) => setNewGroupTitle(e.target.value)} placeholder="Group title" />
        <div className="members-pick">
          {users.map((user) => (
            <label key={`pick-${user.id}`}>
              <input
                type="checkbox"
                checked={selectedMembers.includes(user.id)}
                onChange={(e) =>
                  setSelectedMembers((prev) =>
                    e.target.checked ? [...prev, user.id] : prev.filter((id) => id !== user.id),
                  )
                }
              />
              {user.username}
            </label>
          ))}
        </div>
        <button onClick={createGroup}>Create group</button>
      </aside>

      <section className="sidebar-middle">
        <div className="section-title">Conversations</div>
        <div className="list">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={`conversation ${activeConversation?.id === conv.id ? 'active' : ''}`}
              onClick={() => setActiveConversation(conv)}
            >
              <div>
                <strong>{conv.title || 'Conversation'}</strong>
                <p>{conv.last_message_preview || 'No messages yet'}</p>
              </div>
              {conv.unread_count > 0 ? <span className="badge">{conv.unread_count}</span> : null}
            </button>
          ))}
        </div>
      </section>

      <main className="chat-main">
        <header>
          <h2>{activeConversation?.title || 'Select conversation'}</h2>
          <p>{typingUsers.length > 0 ? `${typingUsers.join(', ')} typing...` : 'Realtime messenger'}</p>
        </header>
        <div className="messages">
          {messages.map((item) => (
            <Message
              key={item.id}
              item={item}
              own={item.sender === (me?.username || auth.username)}
              onEdit={editMessage}
              onDelete={deleteMessage}
            />
          ))}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <input
            value={messageText}
            onChange={(e) => onTyping(e.target.value)}
            placeholder={activeConversation ? `Message ${activeConversation.title}` : 'Choose conversation first'}
            disabled={!activeConversation}
          />
          <input type="file" onChange={(e) => setAttachment(e.target.files?.[0] || null)} />
          <button type="submit" disabled={!activeConversation}>
            Send
          </button>
        </form>
      </main>
    </div>
  )
}

export default MessengerApp

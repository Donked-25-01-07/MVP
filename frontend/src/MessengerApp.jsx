import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import Message from './components/Message'
import { useWebSocket } from './hooks/useWebSocket'
import { defaultThemeKey, themes } from './theme'

const translations = {
  ru: {
    appName: 'Verdgram',
    appSubtitle: 'Сообщения и звонки',
    online: 'В сети',
    reconnecting: 'Переподключение',
    conversations: 'Диалоги',
    searchConversations: 'Поиск диалогов',
    noConversations: 'Пока нет диалогов',
    notifications: 'Непрочитанные',
    unreadSuffix: 'непрочитанных',
    newChat: 'Новый чат',
    searchUsers: 'Поиск пользователей',
    startDm: 'Написать',
    createGroup: 'Создать группу',
    groupTitle: 'Название группы',
    groupMembers: 'Участники',
    groupCreateAction: 'Создать',
    logout: 'Выйти',
    language: 'Язык',
    theme: 'Тема',
    selectChat: 'Выберите диалог',
    selectChatHint: 'Откройте чат слева или создайте новый.',
    back: 'Назад',
    directChat: 'Личный диалог',
    groupChat: 'Групповой чат',
    typing: 'печатает...',
    inputPlaceholder: 'Введите сообщение',
    chooseChatFirst: 'Сначала выберите чат',
    send: 'Отправить',
    attach: 'Файл',
    removeAttachment: 'Убрать файл',
    attached: 'Прикреплено',
    attachmentFallback: '[attachment]',
    save: 'Сохранить',
    cancel: 'Отмена',
    edit: 'Изменить',
    delete: 'Удалить',
    edited: 'изменено',
    attachment: 'Вложение',
  },
  en: {
    appName: 'Verdgram',
    appSubtitle: 'Messages and calls',
    online: 'Online',
    reconnecting: 'Reconnecting',
    conversations: 'Conversations',
    searchConversations: 'Search chats',
    noConversations: 'No conversations yet',
    notifications: 'Unread',
    unreadSuffix: 'unread',
    newChat: 'New chat',
    searchUsers: 'Search users',
    startDm: 'Message',
    createGroup: 'Create group',
    groupTitle: 'Group title',
    groupMembers: 'Members',
    groupCreateAction: 'Create',
    logout: 'Logout',
    language: 'Language',
    theme: 'Theme',
    selectChat: 'Select a conversation',
    selectChatHint: 'Pick a chat from the list or create a new one.',
    back: 'Back',
    directChat: 'Direct chat',
    groupChat: 'Group chat',
    typing: 'typing...',
    inputPlaceholder: 'Type a message',
    chooseChatFirst: 'Choose a conversation first',
    send: 'Send',
    attach: 'File',
    removeAttachment: 'Remove file',
    attached: 'Attached',
    attachmentFallback: '[attachment]',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    edited: 'edited',
    attachment: 'Attachment',
  },
}

function MessengerApp({ auth, onLogout }) {
  const storedTheme = localStorage.getItem('themeKey')
  const storedLanguage = localStorage.getItem('languageKey')

  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [typingUsers, setTypingUsers] = useState([])
  const [conversationSearch, setConversationSearch] = useState('')
  const [userSearchInput, setUserSearchInput] = useState('')
  const [debouncedUserQuery, setDebouncedUserQuery] = useState('')
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [selectedMembers, setSelectedMembers] = useState([])
  const [messageText, setMessageText] = useState('')
  const [themeKey, setThemeKey] = useState(themes[storedTheme] ? storedTheme : defaultThemeKey)
  const [language, setLanguage] = useState(storedLanguage === 'en' ? 'en' : 'ru')
  const [notificationCount, setNotificationCount] = useState(0)
  const [attachment, setAttachment] = useState(null)

  const endRef = useRef(null)
  const activeConversationRef = useRef(activeConversation)
  const meRef = useRef(me)
  const refreshTimerRef = useRef(null)
  const hasInitializedConversationRef = useRef(false)
  const typingStateRef = useRef({
    conversationId: null,
    isTyping: false,
    lastSentAt: 0,
    stopTimer: null,
  })

  const languagePack = translations[language]
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  const theme = themes[themeKey]

  const authRequest = useCallback((path, options = {}) => api(path, { token: auth.token, ...options }), [auth.token])

  const loadConversations = useCallback(async () => {
    const data = await authRequest('/conversations')
    setConversations(data)
    setActiveConversation((previousConversation) => {
      if (data.length === 0) return null
      if (!previousConversation) {
        if (!hasInitializedConversationRef.current) {
          hasInitializedConversationRef.current = true
          return data[0]
        }
        return null
      }
      return data.find((item) => item.id === previousConversation.id) || data[0]
    })
  }, [authRequest])

  const loadUnreadCount = useCallback(async () => {
    const unread = await authRequest('/notifications/unread-count')
    setNotificationCount(unread.unread_count)
  }, [authRequest])

  const scheduleSidebarRefresh = useCallback(() => {
    if (refreshTimerRef.current) return
    refreshTimerRef.current = window.setTimeout(async () => {
      refreshTimerRef.current = null
      try {
        await Promise.all([loadConversations(), loadUnreadCount()])
      } catch {
        // Silent refresh in background.
      }
    }, 320)
  }, [loadConversations, loadUnreadCount])

  useEffect(() => {
    activeConversationRef.current = activeConversation
  }, [activeConversation])

  useEffect(() => {
    meRef.current = me
  }, [me])

  useEffect(() => {
    const bootstrap = async () => {
      const [meRow] = await Promise.all([authRequest('/me'), loadConversations(), loadUnreadCount()])
      setMe(meRow)
    }
    bootstrap()
  }, [authRequest, loadConversations, loadUnreadCount])

  useEffect(() => {
    const timerId = window.setTimeout(() => setDebouncedUserQuery(userSearchInput), 260)
    return () => window.clearTimeout(timerId)
  }, [userSearchInput])

  useEffect(() => {
    const loadUsers = async () => {
      const rows = await authRequest(`/users?q=${encodeURIComponent(debouncedUserQuery.trim())}`)
      setUsers(rows)
    }
    loadUsers()
  }, [authRequest, debouncedUserQuery])

  useEffect(() => {
    const bootstrapMessages = async () => {
      if (!activeConversation?.id) return
      const data = await authRequest(`/conversations/${activeConversation.id}/messages`)
      setMessages(data)
      setTypingUsers([])
    }
    bootstrapMessages()
  }, [activeConversation?.id, authRequest])

  useEffect(() => {
    localStorage.setItem('themeKey', themeKey)
  }, [themeKey])

  useEffect(() => {
    localStorage.setItem('languageKey', language)
  }, [language])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typingUsers])

  useEffect(() => {
    const typingState = typingStateRef.current
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
      if (typingState.stopTimer) window.clearTimeout(typingState.stopTimer)
    }
  }, [])

  const onSocketEvent = useCallback(
    (payload) => {
      const { event, data } = payload || {}
      if (!event) return

      if (event === 'message:new') {
        setMessages((previousMessages) => {
          if (data?.conversation_id !== activeConversationRef.current?.id) return previousMessages
          if (previousMessages.some((message) => message.id === data.id)) return previousMessages
          return [...previousMessages, data]
        })
        scheduleSidebarRefresh()
      }

      if (event === 'typing:start' && data?.conversation_id === activeConversationRef.current?.id) {
        const typingName = data.username || String(data.user_id)
        if (typingName === meRef.current?.username) return
        setTypingUsers((previousUsers) => [...new Set([...previousUsers, typingName])])
      }

      if (event === 'typing:stop' && data?.conversation_id === activeConversationRef.current?.id) {
        const typingName = data.username || String(data.user_id)
        setTypingUsers((previousUsers) => previousUsers.filter((name) => name !== typingName))
      }
    },
    [scheduleSidebarRefresh],
  )

  const { connected, sendEvent } = useWebSocket({ token: auth.token, onEvent: onSocketEvent })

  const stopTyping = useCallback(
    (conversationId) => {
      const state = typingStateRef.current
      if (state.stopTimer) {
        window.clearTimeout(state.stopTimer)
        state.stopTimer = null
      }
      if (state.isTyping && conversationId) {
        sendEvent('typing:stop', { conversation_id: conversationId })
      }
      state.isTyping = false
      state.conversationId = conversationId || null
    },
    [sendEvent],
  )

  const createDm = async (username) => {
    const conversation = await authRequest('/conversations/dm', {
      method: 'POST',
      body: { username },
    })
    await Promise.all([loadConversations(), loadUnreadCount()])
    hasInitializedConversationRef.current = true
    setActiveConversation(conversation)
  }

  const createGroup = async () => {
    if (!newGroupTitle.trim() || selectedMembers.length === 0) return
    const conversation = await authRequest('/conversations/group', {
      method: 'POST',
      body: {
        title: newGroupTitle.trim(),
        member_ids: selectedMembers,
      },
    })
    setNewGroupTitle('')
    setSelectedMembers([])
    await Promise.all([loadConversations(), loadUnreadCount()])
    hasInitializedConversationRef.current = true
    setActiveConversation(conversation)
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    if (!activeConversation?.id) return
    const text = messageText.trim()
    if (!text && !attachment) return

    const conversationId = activeConversation.id
    stopTyping(conversationId)
    setTypingUsers((previousUsers) => previousUsers.filter((name) => name !== (meRef.current?.username || auth.username)))

    let payload = { content: text || languagePack.attachmentFallback }
    if (attachment) {
      const formData = new FormData()
      formData.append('file', attachment)
      const upload = await authRequest('/attachments', {
        method: 'POST',
        body: formData,
        isForm: true,
      })
      payload = { ...payload, attachment_url: upload.url, attachment_name: upload.name }
    }

    const created = await authRequest(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: payload,
    })
    setMessages((previousMessages) =>
      previousMessages.some((message) => message.id === created.id) ? previousMessages : [...previousMessages, created],
    )
    setAttachment(null)
    setMessageText('')
    scheduleSidebarRefresh()
  }

  const editMessage = async (messageId, content) => {
    const updated = await authRequest(`/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    })
    setMessages((previousMessages) => previousMessages.map((message) => (message.id === updated.id ? updated : message)))
  }

  const deleteMessage = async (messageId) => {
    await authRequest(`/messages/${messageId}`, { method: 'DELETE' })
    setMessages((previousMessages) =>
      previousMessages.map((message) =>
        message.id === messageId ? { ...message, content: '[deleted]', deleted_at: new Date().toISOString() } : message,
      ),
    )
  }

  const onComposerChange = (value) => {
    setMessageText(value)
    if (!activeConversation?.id) return

    const state = typingStateRef.current
    if (state.conversationId && state.conversationId !== activeConversation.id) {
      stopTyping(state.conversationId)
    }
    state.conversationId = activeConversation.id

    if (state.stopTimer) {
      window.clearTimeout(state.stopTimer)
      state.stopTimer = null
    }

    if (!value.trim()) {
      if (state.isTyping) {
        sendEvent('typing:stop', { conversation_id: activeConversation.id })
      }
      state.isTyping = false
      return
    }

    const now = Date.now()
    if (!state.isTyping || now - state.lastSentAt > 900) {
      sendEvent('typing:start', { conversation_id: activeConversation.id })
      state.isTyping = true
      state.lastSentAt = now
    }

    state.stopTimer = window.setTimeout(() => {
      const currentState = typingStateRef.current
      if (currentState.isTyping && currentState.conversationId === activeConversation.id) {
        sendEvent('typing:stop', { conversation_id: activeConversation.id })
        currentState.isTyping = false
      }
      currentState.stopTimer = null
    }, 1300)
  }

  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase()
    if (!query) return conversations
    return conversations.filter((conversation) => {
      const title = (conversation.title || '').toLowerCase()
      const preview = (conversation.last_message_preview || '').toLowerCase()
      return title.includes(query) || preview.includes(query)
    })
  }, [conversationSearch, conversations])

  const typingText = typingUsers.length > 0
    ? `${typingUsers.join(', ')} ${languagePack.typing}`
    : activeConversation?.type === 'group'
      ? languagePack.groupChat
      : languagePack.directChat

  const applyTheme = useMemo(
    () => ({
      '--page-bg': theme.pageBg,
      '--page-gradient': theme.pageGradient,
      '--sidebar-bg': theme.sidebarBg,
      '--sidebar-border': theme.sidebarBorder,
      '--chat-bg': theme.chatBg,
      '--chat-pattern': theme.chatPattern,
      '--header-bg': theme.headerBg,
      '--text': theme.text,
      '--text-muted': theme.textMuted,
      '--accent': theme.accent,
      '--accent-hover': theme.accentHover,
      '--accent-soft': theme.accentSoft,
      '--badge-bg': theme.badgeBg,
      '--badge-text': theme.badgeText,
      '--input-bg': theme.inputBg,
      '--input-border': theme.inputBorder,
      '--input-text': theme.inputText,
      '--bubble-own-bg': theme.bubbleOwnBg,
      '--bubble-own-text': theme.bubbleOwnText,
      '--bubble-other-bg': theme.bubbleOtherBg,
      '--bubble-other-text': theme.bubbleOtherText,
      '--bubble-meta': theme.bubbleMeta,
      '--card-bg': theme.cardBg,
      '--card-hover': theme.cardHover,
      '--danger': theme.danger,
      '--success': theme.success,
      '--focus': theme.focus,
    }),
    [theme],
  )

  return (
    <div className={`app-shell ${activeConversation ? 'mobile-chat-open' : ''}`} style={applyTheme}>
      <aside className="sidebar-left">
        <div className="sidebar-head">
          <div>
            <h1 className="brand-title">{languagePack.appName}</h1>
            <p className="brand-subtitle">{languagePack.appSubtitle}</p>
          </div>
          <span className={`connection-pill ${connected ? 'online' : 'offline'}`}>
            {connected ? languagePack.online : languagePack.reconnecting}
          </span>
        </div>

        <div className="toolbar">
          <label className="select-wrap">
            <span>{languagePack.language}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="select-wrap">
            <span>{languagePack.theme}</span>
            <select value={themeKey} onChange={(event) => setThemeKey(event.target.value)}>
              {Object.entries(themes).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="section">
          <div className="section-title">{languagePack.conversations}</div>
          <input
            className="search-input"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
            placeholder={languagePack.searchConversations}
          />
          <div className="conversation-list">
            {filteredConversations.length === 0 ? <p className="empty-list">{languagePack.noConversations}</p> : null}
            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-card ${activeConversation?.id === conversation.id ? 'active' : ''}`}
                onClick={() => {
                  hasInitializedConversationRef.current = true
                  setActiveConversation(conversation)
                }}
                type="button"
              >
                <div className="conversation-main">
                  <strong>{conversation.title || 'Conversation'}</strong>
                  <p>{conversation.last_message_preview || '...'}</p>
                </div>
                <div className="conversation-meta">
                  {conversation.last_message_at ? (
                    <small>
                      {new Date(conversation.last_message_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  ) : null}
                  {conversation.unread_count > 0 ? <span className="badge">{conversation.unread_count}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="quick-actions">
          <div className="section-title">{languagePack.newChat}</div>
          <input
            className="search-input"
            value={userSearchInput}
            onChange={(event) => setUserSearchInput(event.target.value)}
            placeholder={languagePack.searchUsers}
          />
          <div className="users-list">
            {users.map((user) => (
              <button key={user.id} type="button" className="user-row" onClick={() => createDm(user.username)}>
                <span>{user.username}</span>
                <small>{user.status || languagePack.online}</small>
                <em>{languagePack.startDm}</em>
              </button>
            ))}
          </div>

          <input
            className="search-input"
            value={newGroupTitle}
            onChange={(event) => setNewGroupTitle(event.target.value)}
            placeholder={languagePack.groupTitle}
          />

          <div className="members-pick" aria-label={languagePack.groupMembers}>
            {users.map((user) => (
              <label key={`member-${user.id}`}>
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(user.id)}
                  onChange={(event) =>
                    setSelectedMembers((previousMembers) =>
                      event.target.checked
                        ? [...previousMembers, user.id]
                        : previousMembers.filter((memberId) => memberId !== user.id),
                    )
                  }
                />
                <span>{user.username}</span>
              </label>
            ))}
          </div>
          <button type="button" className="create-group-btn" onClick={createGroup}>
            {languagePack.createGroup}
          </button>
        </div>

        <div className="sidebar-foot">
          <div className="notifications">
            <strong>{languagePack.notifications}</strong>
            <span>
              {notificationCount} {languagePack.unreadSuffix}
            </span>
          </div>
          <div className="profile-row">
            <div>
              <strong>{me?.username || auth.username}</strong>
              <p>{me?.bio || languagePack.appSubtitle}</p>
            </div>
            <button type="button" className="logout-btn" onClick={onLogout}>
              {languagePack.logout}
            </button>
          </div>
        </div>
      </aside>

      <main className="chat-main">
        {!activeConversation ? (
          <div className="empty-chat">
            <h2>{languagePack.selectChat}</h2>
            <p>{languagePack.selectChatHint}</p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <button type="button" className="mobile-back" onClick={() => setActiveConversation(null)}>
                {languagePack.back}
              </button>
              <div>
                <h2>{activeConversation.title}</h2>
                <p>{typingText}</p>
              </div>
            </header>

            <div className="messages-layer">
              <div className="messages">
                {messages.map((item) => (
                  <Message
                    key={item.id}
                    item={item}
                    own={item.sender === (me?.username || auth.username)}
                    onEdit={editMessage}
                    onDelete={deleteMessage}
                    labels={languagePack}
                    locale={locale}
                  />
                ))}

                {typingUsers.length > 0 ? (
                  <div className="typing-row">
                    <div className="typing-bubble">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                ) : null}
                <div ref={endRef} />
              </div>
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <input
                value={messageText}
                onChange={(event) => onComposerChange(event.target.value)}
                placeholder={activeConversation ? languagePack.inputPlaceholder : languagePack.chooseChatFirst}
                disabled={!activeConversation}
              />

              <label className="attach-btn" title={languagePack.attach}>
                <input type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />
                {languagePack.attach}
              </label>

              <button type="submit" disabled={!activeConversation}>
                {languagePack.send}
              </button>

              {attachment ? (
                <div className="attachment-chip">
                  <span>
                    {languagePack.attached}: {attachment.name}
                  </span>
                  <button type="button" onClick={() => setAttachment(null)}>
                    {languagePack.removeAttachment}
                  </button>
                </div>
              ) : null}
            </form>
          </>
        )}
      </main>
    </div>
  )
}

export default MessengerApp

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, resolveMediaUrl } from './api'
import Message from './components/Message'
import { useWebSocket } from './hooks/useWebSocket'
import { defaultThemeKey, themes } from './theme'

const texts = {
  ru: {
    appName: 'Verdgram',
    appSubtitle: 'Сообщения и звонки',
    online: 'В сети',
    reconnecting: 'Переподключение...',
    search: 'Поиск',
    noConversations: 'Нет чатов',
    unread: 'Непрочитанные',
    unreadSuffix: 'непрочитанных',
    all: 'Все',
    groups: 'Группы',
    direct: 'Личные',
    archive: 'Архив',
    newChat: 'Новый чат',
    searchUsers: 'Поиск пользователей',
    noUsers: 'Ничего не найдено',
    startDm: 'Написать',
    groupTitle: 'Название группы',
    createGroup: 'Создать группу',
    profile: 'Профиль',
    chatSettings: 'Настройки чата',
    save: 'Сохранить',
    cancel: 'Отмена',
    delete: 'Удалить',
    deleteChat: 'Удалить чат',
    deleteAll: 'Удалить для всех',
    pinChat: 'Закрепить',
    archiveChat: 'Архивировать',
    unarchiveChat: 'Разархивировать',
    mute1h: 'Mute 1h',
    mute8h: 'Mute 8h',
    muteForever: 'Mute forever',
    unmute: 'Включить звук',
    selectChat: 'Выберите чат',
    selectChatHint: 'Откройте чат слева или создайте новый.',
    typing: 'печатает...',
    directChat: 'Личный чат',
    groupChat: 'Групповой чат',
    inputPlaceholder: 'Введите сообщение',
    chooseChatFirst: 'Сначала выберите чат',
    attach: 'Файл',
    removeAttachment: 'Убрать файл',
    attached: 'Прикреплено',
    send: 'Отправить',
    sendFileHint: 'Можно отправлять только файл без текста.',
    attachmentFallback: '[вложение]',
    back: 'Назад',
    menu: 'Меню',
    language: 'Язык',
    theme: 'Тема',
    logout: 'Выйти',
    saved: 'Избранное',
    openSaved: 'Открыть избранное',
    dragHere: 'Перетащите файл сюда',
    searchInChat: 'Поиск в чате',
    noResults: 'Ничего не найдено',
    members: 'Участники',
    media: 'Медиа',
    noMedia: 'Пока нет медиа',
    renameGroup: 'Переименовать группу',
    profileBio: 'О себе',
    profileAvatar: 'Аватар',
    profileSaved: 'Профиль сохранен',
    reply: 'Ответить',
    forward: 'Переслать',
    reactions: 'Реакции',
    forwardTo: 'Куда переслать',
    edited: 'изменено',
    error: 'Ошибка',
  },
  en: {
    appName: 'Verdgram',
    appSubtitle: 'Messages and calls',
    online: 'Online',
    reconnecting: 'Reconnecting...',
    search: 'Search',
    noConversations: 'No chats',
    unread: 'Unread',
    unreadSuffix: 'unread',
    all: 'All',
    groups: 'Groups',
    direct: 'Direct',
    archive: 'Archive',
    newChat: 'New chat',
    searchUsers: 'Search users',
    noUsers: 'No users found',
    startDm: 'Message',
    groupTitle: 'Group title',
    createGroup: 'Create group',
    profile: 'Profile',
    chatSettings: 'Chat settings',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteChat: 'Delete chat',
    deleteAll: 'Delete for everyone',
    pinChat: 'Pin chat',
    archiveChat: 'Archive chat',
    unarchiveChat: 'Unarchive chat',
    mute1h: 'Mute 1h',
    mute8h: 'Mute 8h',
    muteForever: 'Mute forever',
    unmute: 'Unmute',
    selectChat: 'Select chat',
    selectChatHint: 'Pick a chat from the left list or create a new one.',
    typing: 'typing...',
    directChat: 'Direct chat',
    groupChat: 'Group chat',
    inputPlaceholder: 'Type a message',
    chooseChatFirst: 'Choose a chat first',
    attach: 'File',
    removeAttachment: 'Remove file',
    attached: 'Attached',
    send: 'Send',
    sendFileHint: 'You can send file without text.',
    attachmentFallback: '[attachment]',
    back: 'Back',
    menu: 'Menu',
    language: 'Language',
    theme: 'Theme',
    logout: 'Logout',
    saved: 'Saved',
    openSaved: 'Open saved',
    dragHere: 'Drop file here',
    searchInChat: 'Search in chat',
    noResults: 'No results found',
    members: 'Members',
    media: 'Media',
    noMedia: 'No media yet',
    renameGroup: 'Rename group',
    profileBio: 'Bio',
    profileAvatar: 'Avatar',
    profileSaved: 'Profile updated',
    reply: 'Reply',
    forward: 'Forward',
    reactions: 'Reactions',
    forwardTo: 'Forward to',
    edited: 'edited',
    error: 'Error',
  },
}

const FOLDERS = ['all', 'unread', 'groups', 'direct', 'archive']
const EMOJI = ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '🔥', '❤️', '👍', '🙏', '🎉']
const QUICK_REACTIONS = ['👍', '🔥', '❤️', '😂', '😎']

function MessengerApp({ auth, onLogout }) {
  const savedTheme = localStorage.getItem('themeKey')
  const savedLanguage = localStorage.getItem('languageKey')

  const [me, setMe] = useState(null)
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState(null)
  const [details, setDetails] = useState(null)
  const [messages, setMessages] = useState([])
  const [typingUsers, setTypingUsers] = useState([])
  const [users, setUsers] = useState([])
  const [conversationSearch, setConversationSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [messageSearch, setMessageSearch] = useState('')
  const [messageSearchResults, setMessageSearchResults] = useState([])
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [selectedMembers, setSelectedMembers] = useState([])
  const [messageText, setMessageText] = useState('')
  const [themeKey, setThemeKey] = useState(themes[savedTheme] ? savedTheme : defaultThemeKey)
  const [language, setLanguage] = useState(savedLanguage === 'en' ? 'en' : 'ru')
  const [folder, setFolder] = useState('all')
  const [notificationCount, setNotificationCount] = useState(0)
  const [attachment, setAttachment] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [showMainMenu, setShowMainMenu] = useState(false)
  const [showChatMenu, setShowChatMenu] = useState(false)
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showForwardModal, setShowForwardModal] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [forwardMessage, setForwardMessage] = useState(null)
  const [profileBio, setProfileBio] = useState('')
  const [profileAvatarFile, setProfileAvatarFile] = useState(null)
  const [chatTitleDraft, setChatTitleDraft] = useState('')
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [errorText, setErrorText] = useState('')
  const [reactionsByMessage, setReactionsByMessage] = useState(() => {
    try {
      const saved = localStorage.getItem(`reactions:${auth.username}`)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  const endRef = useRef(null)
  const fileInputRef = useRef(null)
  const textareaRef = useRef(null)
  const activeConversationRef = useRef(activeConversation)
  const meRef = useRef(me)
  const refreshTimerRef = useRef(null)
  const dragDepthRef = useRef(0)
  const typingStateRef = useRef({
    conversationId: null,
    isTyping: false,
    lastSentAt: 0,
    stopTimer: null,
  })

  const t = texts[language]
  const locale = language === 'ru' ? 'ru-RU' : 'en-US'
  const theme = themes[themeKey]
  const authRequest = useCallback((path, options = {}) => api(path, { token: auth.token, ...options }), [auth.token])

  const loadUnread = useCallback(async () => {
    const unread = await authRequest('/notifications/unread-count')
    setNotificationCount(unread.unread_count)
  }, [authRequest])

  const loadConversations = useCallback(async () => {
    const includeArchived = folder === 'archive'
    const rows = await authRequest(`/conversations?include_archived=${includeArchived}`)
    setConversations(rows)
    setActiveConversation((prev) => rows.find((item) => item.id === prev?.id) || null)
  }, [authRequest, folder])

  const loadDetails = useCallback(async (conversationId) => {
    const row = await authRequest(`/conversations/${conversationId}`)
    setDetails(row)
    setChatTitleDraft(row.title || '')
  }, [authRequest])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return
    refreshTimerRef.current = window.setTimeout(async () => {
      refreshTimerRef.current = null
      try {
        await Promise.all([loadConversations(), loadUnread()])
      } catch {
        // Silent refresh.
      }
    }, 280)
  }, [loadConversations, loadUnread])

  useEffect(() => {
    activeConversationRef.current = activeConversation
  }, [activeConversation])

  useEffect(() => {
    meRef.current = me
  }, [me])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [meRow] = await Promise.all([authRequest('/me'), loadConversations(), loadUnread()])
        setMe(meRow)
        setProfileBio(meRow.bio || '')
      } catch (error) {
        setErrorText(error.message)
      }
    }
    bootstrap()
  }, [authRequest, loadConversations, loadUnread])

  useEffect(() => {
    localStorage.setItem('themeKey', themeKey)
  }, [themeKey])

  useEffect(() => {
    localStorage.setItem('languageKey', language)
  }, [language])

  useEffect(() => {
    localStorage.setItem(`reactions:${auth.username}`, JSON.stringify(reactionsByMessage))
  }, [auth.username, reactionsByMessage])

  useEffect(() => {
    const query = userSearch.trim()
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUsers([])
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const rows = await authRequest(`/users?q=${encodeURIComponent(query)}`)
        setUsers(rows)
      } catch (error) {
        setErrorText(error.message)
      }
    }, 220)
    return () => window.clearTimeout(timer)
  }, [authRequest, userSearch])

  useEffect(() => {
    const run = async () => {
      if (!activeConversation?.id) {
        setMessages([])
        setDetails(null)
        setReplyTo(null)
        return
      }
      try {
        const [rows] = await Promise.all([
          authRequest(`/conversations/${activeConversation.id}/messages`),
          loadDetails(activeConversation.id),
        ])
        setMessages(rows)
        setTypingUsers([])
      } catch (error) {
        setErrorText(error.message)
      }
    }
    run()
  }, [activeConversation?.id, authRequest, loadDetails])

  useEffect(() => {
    if (!activeConversation?.id || messageSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessageSearchResults([])
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const rows = await authRequest(`/conversations/${activeConversation.id}/search?q=${encodeURIComponent(messageSearch.trim())}`)
        setMessageSearchResults(rows)
      } catch (error) {
        setErrorText(error.message)
      }
    }, 260)
    return () => window.clearTimeout(timer)
  }, [activeConversation?.id, authRequest, messageSearch])

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

  const onSocketEvent = useCallback((payload) => {
    const { event, data } = payload || {}
    if (!event) return
    if (event === 'message:new') {
      setMessages((prev) => {
        if (data?.conversation_id !== activeConversationRef.current?.id) return prev
        if (prev.some((message) => message.id === data.id)) return prev
        return [...prev, data]
      })
      scheduleRefresh()
    }
    if (event === 'typing:start' && data?.conversation_id === activeConversationRef.current?.id) {
      const name = data.username || String(data.user_id)
      if (name !== meRef.current?.username) setTypingUsers((prev) => [...new Set([...prev, name])])
    }
    if (event === 'typing:stop' && data?.conversation_id === activeConversationRef.current?.id) {
      const name = data.username || String(data.user_id)
      setTypingUsers((prev) => prev.filter((item) => item !== name))
    }
    if (event === 'message:read' && data?.conversation_id === activeConversationRef.current?.id) {
      setMessages((prev) => prev.map((msg) => (msg.id === data.message_id ? { ...msg, read_by: [...new Set([...(msg.read_by || []), data.user_id])] } : msg)))
    }
    if (event === 'message:delivered' && data?.conversation_id === activeConversationRef.current?.id) {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === data.message_id ? { ...msg, delivered_to: [...new Set([...(msg.delivered_to || []), data.user_id])] } : msg)),
      )
    }
  }, [scheduleRefresh])

  const { connected, sendEvent } = useWebSocket({ token: auth.token, onEvent: onSocketEvent })

  const stopTyping = useCallback((conversationId) => {
    const state = typingStateRef.current
    if (state.stopTimer) window.clearTimeout(state.stopTimer)
    if (state.isTyping && conversationId) sendEvent('typing:stop', { conversation_id: conversationId })
    state.stopTimer = null
    state.isTyping = false
    state.conversationId = conversationId || null
  }, [sendEvent])

  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase()
    let list = conversations
    if (folder === 'unread') list = list.filter((item) => item.unread_count > 0)
    if (folder === 'groups') list = list.filter((item) => item.type === 'group')
    if (folder === 'direct') list = list.filter((item) => item.type === 'dm')
    if (folder === 'archive') list = list.filter((item) => item.is_archived)
    if (!query) return list
    return list.filter((item) => (item.title || '').toLowerCase().includes(query) || (item.last_message_preview || '').toLowerCase().includes(query))
  }, [conversations, conversationSearch, folder])

  const typingText = (() => {
    if (typingUsers.length > 0) return `${typingUsers.join(', ')} ${t.typing}`
    if (details?.type === 'group') return `${details.members.length} ${t.members.toLowerCase()}`
    return activeConversation?.type === 'group' ? t.groupChat : t.directChat
  })()

  const avatarPreview = profileAvatarFile ? URL.createObjectURL(profileAvatarFile) : resolveMediaUrl(me?.avatar_url)

  const setComposerText = (value) => {
    setMessageText(value)
    if (!activeConversation?.id) return
    const state = typingStateRef.current
    if (state.conversationId && state.conversationId !== activeConversation.id) stopTyping(state.conversationId)
    state.conversationId = activeConversation.id
    if (state.stopTimer) window.clearTimeout(state.stopTimer)
    if (!value.trim()) {
      if (state.isTyping) sendEvent('typing:stop', { conversation_id: activeConversation.id })
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
      const current = typingStateRef.current
      if (current.isTyping && current.conversationId === activeConversation.id) {
        sendEvent('typing:stop', { conversation_id: activeConversation.id })
        current.isTyping = false
      }
      current.stopTimer = null
    }, 1200)
  }

  const sendMessage = async () => {
    if (!activeConversation?.id) return
    const text = messageText.trim()
    if (!text && !attachment) return
    stopTyping(activeConversation.id)
    let payload = { content: text || t.attachmentFallback }
    if (replyTo && text) payload.content = `↪ ${replyTo.sender}: ${replyTo.content.slice(0, 120)}\n${text}`
    try {
      if (attachment) {
        const formData = new FormData()
        formData.append('file', attachment)
        const upload = await authRequest('/attachments', { method: 'POST', body: formData, isForm: true })
        payload = { ...payload, attachment_url: upload.url, attachment_name: upload.name }
      }
      const created = await authRequest(`/conversations/${activeConversation.id}/messages`, { method: 'POST', body: payload })
      setMessages((prev) => (prev.some((item) => item.id === created.id) ? prev : [...prev, created]))
      setMessageText('')
      setReplyTo(null)
      setAttachment(null)
      setShowEmojiPicker(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      scheduleRefresh()
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const applySettings = async (changes) => {
    if (!activeConversation?.id) return
    try {
      const updated = await authRequest(`/conversations/${activeConversation.id}/settings`, { method: 'PATCH', body: changes })
      setConversations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setActiveConversation(updated)
      await loadDetails(updated.id)
      scheduleRefresh()
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const deleteChat = async (forEveryone = false) => {
    if (!activeConversation?.id) return
    if (!window.confirm(forEveryone ? t.deleteAll : t.deleteChat)) return
    try {
      await authRequest(`/conversations/${activeConversation.id}?for_everyone=${forEveryone}`, { method: 'DELETE' })
      setConversations((prev) => prev.filter((item) => item.id !== activeConversation.id))
      setActiveConversation(null)
      setMessages([])
      setDetails(null)
      scheduleRefresh()
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const createDm = async (username) => {
    try {
      const conversation = await authRequest('/conversations/dm', { method: 'POST', body: { username } })
      await Promise.all([loadConversations(), loadUnread()])
      setActiveConversation(conversation)
      setShowNewChatModal(false)
      setUserSearch('')
      setUsers([])
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const createGroup = async () => {
    if (!newGroupTitle.trim() || selectedMembers.length === 0) return
    try {
      const conversation = await authRequest('/conversations/group', {
        method: 'POST',
        body: { title: newGroupTitle.trim(), member_ids: selectedMembers },
      })
      await Promise.all([loadConversations(), loadUnread()])
      setActiveConversation(conversation)
      setShowNewChatModal(false)
      setNewGroupTitle('')
      setSelectedMembers([])
      setUserSearch('')
      setUsers([])
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const openSaved = async () => {
    try {
      const conversation = await authRequest('/conversations/saved', { method: 'POST' })
      await Promise.all([loadConversations(), loadUnread()])
      setActiveConversation(conversation)
      setShowMainMenu(false)
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const saveProfile = async () => {
    try {
      let avatarUrl = me?.avatar_url || null
      if (profileAvatarFile) {
        const formData = new FormData()
        formData.append('file', profileAvatarFile)
        const upload = await authRequest('/attachments', { method: 'POST', body: formData, isForm: true })
        avatarUrl = upload.url
      }
      const updated = await authRequest('/me', { method: 'PATCH', body: { bio: profileBio, avatar_url: avatarUrl } })
      setMe(updated)
      setShowProfileModal(false)
      setProfileAvatarFile(null)
      setFeedbackText(t.profileSaved)
      window.setTimeout(() => setFeedbackText(''), 1800)
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const toggleReaction = (messageId, emoji) => {
    const username = me?.username || auth.username
    setReactionsByMessage((prev) => {
      const next = { ...prev }
      const bucket = { ...(next[messageId] || {}) }
      const usersSet = new Set(bucket[emoji] || [])
      if (usersSet.has(username)) usersSet.delete(username)
      else usersSet.add(username)
      if (usersSet.size === 0) delete bucket[emoji]
      else bucket[emoji] = [...usersSet]
      if (Object.keys(bucket).length === 0) delete next[messageId]
      else next[messageId] = bucket
      return next
    })
  }

  const editMessage = async (messageId, content) => {
    try {
      const updated = await authRequest(`/messages/${messageId}`, {
        method: 'PATCH',
        body: { content },
      })
      setMessages((prev) => prev.map((msg) => (msg.id === updated.id ? updated : msg)))
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const removeMessage = async (messageId) => {
    try {
      await authRequest(`/messages/${messageId}`, { method: 'DELETE' })
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, content: '[deleted]', deleted_at: new Date().toISOString() } : msg)),
      )
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const forwardToConversation = async (conversationId) => {
    if (!forwardMessage) return
    const payload = {
      content: forwardMessage.content || t.attachmentFallback,
      attachment_url: forwardMessage.attachment_url || null,
      attachment_name: forwardMessage.attachment_name || null,
    }
    try {
      const created = await authRequest(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: payload,
      })
      if (activeConversation?.id === conversationId) {
        setMessages((prev) => [...prev, created])
      }
      setShowForwardModal(false)
      setForwardMessage(null)
      scheduleRefresh()
    } catch (error) {
      setErrorText(error.message)
    }
  }

  const onComposerKeyDown = async (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      await sendMessage()
    }
  }

  const onDragEnter = (event) => {
    event.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const onDragLeave = (event) => {
    event.preventDefault()
    dragDepthRef.current -= 1
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0
      setDragActive(false)
    }
  }

  const onDragOver = (event) => {
    event.preventDefault()
  }

  const onDrop = (event) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) setAttachment(dropped)
  }

  const closeError = () => setErrorText('')

  const applyTheme = useMemo(() => ({
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
  }), [theme])

  return (
    <div className={`app-shell tg-shell ${activeConversation ? 'mobile-chat-open' : ''}`} style={applyTheme}>
      <aside className="sidebar-left">
        <div className="sidebar-head tg-head">
          <button type="button" className="icon-btn" onClick={() => setShowMainMenu((prev) => !prev)} title={t.menu}>
            ☰
          </button>
          <input
            className="search-input"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
            placeholder={t.search}
          />
          <button
            type="button"
            className="avatar-pill"
            onClick={() => {
              setProfileBio(me?.bio || '')
              setShowProfileModal(true)
            }}
          >
            {me?.avatar_url ? <img src={resolveMediaUrl(me.avatar_url)} alt={me?.username || auth.username} /> : <span>{(me?.username || auth.username)[0]}</span>}
          </button>
        </div>

        {showMainMenu ? (
          <div className="dropdown-card main-dropdown">
            <button type="button" onClick={() => setShowNewChatModal(true)}>
              {t.newChat}
            </button>
            <button type="button" onClick={openSaved}>
              {t.openSaved}
            </button>
            <button type="button" onClick={() => setShowProfileModal(true)}>
              {t.profile}
            </button>
            <div className="dropdown-split" />
            <label className="menu-inline">
              <span>{t.language}</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="menu-inline">
              <span>{t.theme}</span>
              <select value={themeKey} onChange={(event) => setThemeKey(event.target.value)}>
                {Object.entries(themes).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="danger-row" onClick={onLogout}>
              {t.logout}
            </button>
          </div>
        ) : null}

        <div className="folder-row">
          {FOLDERS.map((item) => (
            <button key={item} type="button" className={`folder-btn ${folder === item ? 'active' : ''}`} onClick={() => setFolder(item)}>
              {item === 'all' ? t.all : null}
              {item === 'unread' ? t.unread : null}
              {item === 'groups' ? t.groups : null}
              {item === 'direct' ? t.direct : null}
              {item === 'archive' ? t.archive : null}
            </button>
          ))}
        </div>

        <div className="conversation-list">
          {filteredConversations.length === 0 ? <p className="empty-list">{t.noConversations}</p> : null}
          {filteredConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`conversation-card tg-card ${activeConversation?.id === conversation.id ? 'active' : ''}`}
              onClick={() => setActiveConversation(conversation)}
            >
              <div className="conversation-avatar">{(conversation.title || '?').slice(0, 1).toUpperCase()}</div>
              <div className="conversation-main">
                <strong>{conversation.title || 'Conversation'}</strong>
                <p>{conversation.last_message_preview || '...'}</p>
              </div>
              <div className="conversation-meta">
                {conversation.is_pinned ? <small>📌</small> : null}
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

        <div className="sidebar-foot">
          <div className="notifications">
            <strong>{t.unread}</strong>
            <span>
              {notificationCount} {t.unreadSuffix}
            </span>
          </div>
          <div className="profile-row tg-profile">
            <div>
              <strong>{me?.username || auth.username}</strong>
              <p>{me?.bio || t.appSubtitle}</p>
            </div>
            <span className={`connection-pill ${connected ? 'online' : 'offline'}`}>
              {connected ? t.online : t.reconnecting}
            </span>
          </div>
        </div>

        <button type="button" className="fab-new" onClick={() => setShowNewChatModal(true)}>
          ✎
        </button>
      </aside>

      <main className="chat-main tg-chat-main" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
        {!activeConversation ? (
          <div className="empty-chat">
            <h2>{t.selectChat}</h2>
            <p>{t.selectChatHint}</p>
          </div>
        ) : (
          <>
            <header className="chat-header tg-chat-header">
              <button type="button" className="mobile-back" onClick={() => setActiveConversation(null)}>
                {t.back}
              </button>
              <div className="chat-head-main">
                <h2>{activeConversation.title}</h2>
                <p>{typingText}</p>
              </div>
              <div className="chat-head-actions">
                <button type="button" className="icon-btn" onClick={() => setRightPanelOpen((prev) => !prev)} title={t.chatSettings}>
                  ⓘ
                </button>
                <button type="button" className="icon-btn" onClick={() => setShowChatMenu((prev) => !prev)} title={t.chatSettings}>
                  ⋮
                </button>
              </div>

              {showChatMenu ? (
                <div className="dropdown-card chat-dropdown">
                  <button type="button" onClick={() => applySettings({ is_pinned: !activeConversation.is_pinned })}>
                    {t.pinChat}
                  </button>
                  <button type="button" onClick={() => applySettings({ is_archived: !activeConversation.is_archived })}>
                    {activeConversation.is_archived ? t.unarchiveChat : t.archiveChat}
                  </button>
                  <button type="button" onClick={() => applySettings({ mute_hours: 1 })}>
                    {t.mute1h}
                  </button>
                  <button type="button" onClick={() => applySettings({ mute_hours: 8 })}>
                    {t.mute8h}
                  </button>
                  <button type="button" onClick={() => applySettings({ mute_hours: -1 })}>
                    {t.muteForever}
                  </button>
                  <button type="button" onClick={() => applySettings({ mute_hours: 0 })}>
                    {t.unmute}
                  </button>
                  <div className="dropdown-split" />
                  <button type="button" className="danger-row" onClick={() => deleteChat(false)}>
                    {t.deleteChat}
                  </button>
                  {activeConversation.can_manage ? (
                    <button type="button" className="danger-row" onClick={() => deleteChat(true)}>
                      {t.deleteAll}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </header>

            <div className={`drop-overlay ${dragActive ? 'show' : ''}`}>
              <span>{t.dragHere}</span>
            </div>

            <div className="messages-layer">
              <div className="messages">
                {messages.map((item) => (
                  <Message
                    key={item.id}
                    item={item}
                    meId={me?.id}
                    own={item.sender === (me?.username || auth.username)}
                    onEdit={editMessage}
                    onDelete={removeMessage}
                    onReply={() => setReplyTo(item)}
                    onForward={() => {
                      setForwardMessage(item)
                      setShowForwardModal(true)
                    }}
                    onReact={(emoji) => toggleReaction(item.id, emoji)}
                    reactions={reactionsByMessage[item.id] || {}}
                    quickReactions={QUICK_REACTIONS}
                    labels={t}
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

            {replyTo ? (
              <div className="reply-banner">
                <div>
                  <strong>{t.reply}</strong>
                  <p>{replyTo.content}</p>
                </div>
                <button type="button" onClick={() => setReplyTo(null)}>
                  {t.cancel}
                </button>
              </div>
            ) : null}

            <form
              className="composer tg-composer"
              onSubmit={async (event) => {
                event.preventDefault()
                await sendMessage()
              }}
            >
              <button type="button" className="emoji-btn" onClick={() => setShowEmojiPicker((prev) => !prev)}>
                🙂
              </button>
              <textarea
                ref={textareaRef}
                value={messageText}
                onChange={(event) => setComposerText(event.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={1}
                placeholder={activeConversation ? t.inputPlaceholder : t.chooseChatFirst}
                disabled={!activeConversation}
              />
              <label className="attach-btn" title={t.attach}>
                <input ref={fileInputRef} type="file" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />
                📎
              </label>
              <button type="submit" className="send-btn" disabled={!activeConversation}>
                ➤
              </button>

              {showEmojiPicker ? (
                <div className="emoji-picker">
                  {EMOJI.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => setComposerText(`${messageText}${emoji}`)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}

              {attachment ? (
                <div className="attachment-chip">
                  <span>
                    {t.attached}: {attachment.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachment(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                  >
                    {t.removeAttachment}
                  </button>
                </div>
              ) : (
                <small className="attachment-hint">{t.sendFileHint}</small>
              )}
            </form>
          </>
        )}
      </main>

      <aside className={`sidebar-right ${rightPanelOpen ? 'open' : ''}`}>
        {!activeConversation ? null : (
          <div className="info-panel">
            <div className="info-top">
              <h3>{t.chatSettings}</h3>
              <button type="button" className="icon-btn" onClick={() => setRightPanelOpen(false)}>
                ✕
              </button>
            </div>
            {activeConversation.type === 'group' && activeConversation.can_manage ? (
              <div className="settings-block">
                <label>{t.renameGroup}</label>
                <input value={chatTitleDraft} onChange={(event) => setChatTitleDraft(event.target.value)} />
                <button type="button" onClick={() => applySettings({ title: chatTitleDraft.trim() })} disabled={!chatTitleDraft.trim()}>
                  {t.save}
                </button>
              </div>
            ) : null}
            <div className="settings-block">
              <label>{t.searchInChat}</label>
              <input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} />
              <div className="mini-list">
                {messageSearch.trim().length >= 2 && messageSearchResults.length === 0 ? <p className="empty-list">{t.noResults}</p> : null}
                {messageSearchResults.map((item) => (
                  <button key={`search-${item.id}`} type="button" onClick={() => document.getElementById(`msg-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                    <strong>{item.sender}</strong>
                    <span>{item.content}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-block">
              <h4>{t.members}</h4>
              <div className="mini-list">
                {details?.members?.map((member) => (
                  <div key={member.id} className="participant-row">
                    <span>{member.username}</span>
                    <small>{member.role}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="settings-block">
              <h4>{t.media}</h4>
              {details?.media?.length ? (
                <div className="media-grid">
                  {details.media.map((mediaItem) => {
                    const url = resolveMediaUrl(mediaItem.attachment_url)
                    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(mediaItem.attachment_name || mediaItem.attachment_url)
                    return (
                      <a key={mediaItem.message_id} href={url} target="_blank" rel="noreferrer" className="media-tile">
                        {isImage ? <img src={url} alt={mediaItem.attachment_name || 'media'} /> : <span>{mediaItem.attachment_name}</span>}
                      </a>
                    )
                  })}
                </div>
              ) : (
                <p className="empty-list">{t.noMedia}</p>
              )}
            </div>
          </div>
        )}
      </aside>

      {showNewChatModal ? (
        <div className="modal-backdrop" onClick={() => setShowNewChatModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t.newChat}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowNewChatModal(false)}>
                ✕
              </button>
            </div>
            <input className="search-input" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder={t.searchUsers} />
            <div className="users-list">
              {userSearch.trim() && users.length === 0 ? <p className="empty-list">{t.noUsers}</p> : null}
              {users.map((user) => (
                <button key={user.id} type="button" className="user-row" onClick={() => createDm(user.username)}>
                  <span>{user.username}</span>
                  <small>{user.status || t.online}</small>
                  <em>{t.startDm}</em>
                </button>
              ))}
            </div>
            <div className="dropdown-split" />
            <input className="search-input" value={newGroupTitle} onChange={(event) => setNewGroupTitle(event.target.value)} placeholder={t.groupTitle} />
            <div className="members-pick">
              {users.map((user) => (
                <label key={`member-${user.id}`}>
                  <input
                    type="checkbox"
                    checked={selectedMembers.includes(user.id)}
                    onChange={(event) =>
                      setSelectedMembers((prev) => (event.target.checked ? [...prev, user.id] : prev.filter((id) => id !== user.id)))
                    }
                  />
                  <span>{user.username}</span>
                </label>
              ))}
            </div>
            <button type="button" className="create-group-btn" onClick={createGroup}>
              {t.createGroup}
            </button>
          </div>
        </div>
      ) : null}

      {showForwardModal ? (
        <div className="modal-backdrop" onClick={() => setShowForwardModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t.forwardTo}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowForwardModal(false)}>
                ✕
              </button>
            </div>
            <div className="mini-list">
              {conversations.map((conversation) => (
                <button key={`forward-${conversation.id}`} type="button" onClick={() => forwardToConversation(conversation.id)}>
                  <strong>{conversation.title}</strong>
                  <span>{conversation.last_message_preview || '...'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showProfileModal ? (
        <div className="modal-backdrop" onClick={() => setShowProfileModal(false)}>
          <div className="modal-card profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h3>{t.profile}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowProfileModal(false)}>
                ✕
              </button>
            </div>
            <label>{t.profileAvatar}</label>
            <div className="avatar-uploader">
              <div className="avatar-preview">
                {avatarPreview ? <img src={avatarPreview} alt={me?.username || auth.username} /> : <span>{(me?.username || auth.username)[0]}</span>}
              </div>
              <input type="file" onChange={(event) => setProfileAvatarFile(event.target.files?.[0] || null)} />
            </div>
            <label>{t.profileBio}</label>
            <textarea value={profileBio} onChange={(event) => setProfileBio(event.target.value)} rows={4} />
            <button type="button" className="create-group-btn" onClick={saveProfile}>
              {t.save}
            </button>
          </div>
        </div>
      ) : null}

      {feedbackText ? <div className="feedback-toast success">{feedbackText}</div> : null}
      {errorText ? (
        <div className="feedback-toast error">
          <span>
            {t.error}: {errorText}
          </span>
          <button type="button" onClick={closeError}>
            ✕
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default MessengerApp

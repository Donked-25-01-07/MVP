import { useMemo, useState } from 'react'
import { resolveMediaUrl } from '../api'

function formatToken(token, key) {
  if (/^https?:\/\/\S+$/i.test(token)) {
    return (
      <a key={key} href={token} target="_blank" rel="noreferrer">
        {token}
      </a>
    )
  }

  if (/^\*\*.+\*\*$/.test(token)) {
    return <strong key={key}>{token.slice(2, -2)}</strong>
  }

  if (/^_.+_$/.test(token) || /^\*.+\*$/.test(token)) {
    return <em key={key}>{token.slice(1, -1)}</em>
  }

  if (/^`.+`$/.test(token)) {
    return <code key={key}>{token.slice(1, -1)}</code>
  }

  return <span key={key}>{token}</span>
}

function formatMessage(content) {
  return content.split('\n').map((line, lineIndex) => (
    <span key={`line-${lineIndex}`}>
      {line.split(/(\s+)/).map((token, tokenIndex) => formatToken(token, `token-${lineIndex}-${tokenIndex}`))}
      {lineIndex < content.split('\n').length - 1 ? <br /> : null}
    </span>
  ))
}

function getStatus(item, meId) {
  const readBy = item.read_by || []
  const deliveredTo = item.delivered_to || []
  const hasReadByPeer = readBy.some((id) => id !== meId)
  const hasDeliveredToPeer = deliveredTo.some((id) => id !== meId)

  if (hasReadByPeer) return { icon: '✓✓', kind: 'read' }
  if (hasDeliveredToPeer) return { icon: '✓✓', kind: 'delivered' }
  return { icon: '✓', kind: 'sent' }
}

function Message({
  item,
  own,
  meId,
  onEdit,
  onDelete,
  onReply,
  onForward,
  onReact,
  reactions,
  quickReactions,
  labels,
  locale,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const date = new Date(item.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const status = useMemo(() => getStatus(item, meId), [item, meId])

  const submitEdit = async () => {
    const nextValue = draft.trim()
    if (!nextValue || nextValue === item.content) {
      setEditing(false)
      return
    }
    await onEdit(item.id, nextValue)
    setEditing(false)
  }

  const attachmentUrl = item.attachment_url ? resolveMediaUrl(item.attachment_url) : null
  const attachmentName = item.attachment_name || labels.attachment
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachmentName || item.attachment_url || '')
  const isVideo = /\.(mp4|webm|ogg|mov|m4v)$/i.test(attachmentName || item.attachment_url || '')
  const reactionEntries = Object.entries(reactions || {})

  return (
    <div id={`msg-${item.id}`} className={`message-row ${own ? 'own' : 'other'}`}>
      <div className={`message-bubble ${item.deleted_at ? 'deleted' : ''}`}>
        <div className="message-header">
          <strong>{item.sender}</strong>
        </div>

        {attachmentUrl ? (
          <div className="attachment-wrap">
            {isImage ? <img className="message-image" src={attachmentUrl} alt={attachmentName} /> : null}
            {isVideo ? (
              <video className="message-video" controls preload="metadata">
                <source src={attachmentUrl} />
              </video>
            ) : null}
            {!isImage && !isVideo ? (
              <a className="attachment-link" href={attachmentUrl} target="_blank" rel="noreferrer">
                {attachmentName}
              </a>
            ) : (
              <a className="attachment-link" href={attachmentUrl} target="_blank" rel="noreferrer">
                {attachmentName}
              </a>
            )}
          </div>
        ) : null}

        {editing ? (
          <div className="message-edit">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button type="button" onClick={submitEdit}>
              {labels.save}
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              {labels.cancel}
            </button>
          </div>
        ) : (
          <p>{formatMessage(item.content)}</p>
        )}

        <div className="message-footer">
          <span>{date}</span>
          {item.edited_at ? <em>{labels.edited}</em> : null}
          {own ? <span className={`status-mark ${status.kind}`}>{status.icon}</span> : null}
        </div>

        {reactionEntries.length > 0 ? (
          <div className="reactions-row">
            {reactionEntries.map(([emoji, users]) => (
              <button key={`${item.id}-${emoji}`} type="button" onClick={() => onReact(emoji)}>
                {emoji} {users.length}
              </button>
            ))}
          </div>
        ) : null}

        {!item.deleted_at ? (
          <div className="message-actions">
            <button type="button" onClick={onReply}>
              {labels.reply}
            </button>
            <button type="button" onClick={onForward}>
              {labels.forward}
            </button>
            {quickReactions.map((emoji) => (
              <button key={`${item.id}-quick-${emoji}`} type="button" onClick={() => onReact(emoji)} title={labels.reactions}>
                {emoji}
              </button>
            ))}
            {own ? (
              <>
                <button type="button" onClick={() => setEditing((prev) => !prev)}>
                  {editing ? labels.cancel : labels.edit}
                </button>
                <button type="button" onClick={() => onDelete(item.id)}>
                  {labels.delete}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Message

import { useState } from 'react'

function Message({ item, own, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const date = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const submitEdit = async () => {
    const nextValue = draft.trim()
    if (!nextValue || nextValue === item.content) return setEditing(false)
    await onEdit(item.id, nextValue)
    setEditing(false)
  }

  return (
    <div className={`message-row ${own ? 'own' : ''}`}>
      <div className="message-bubble">
        <div className="message-header">
          <strong>{item.sender}</strong>
          <span>{date}</span>
          {item.edited_at ? <em>(edited)</em> : null}
        </div>
        {item.attachment_url ? (
          <a href={`${import.meta.env.VITE_API_BASE_URL}${item.attachment_url}`} target="_blank" rel="noreferrer">
            {item.attachment_name || 'Attachment'}
          </a>
        ) : null}
        {editing ? (
          <div className="message-edit">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button onClick={submitEdit}>Save</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <p>{item.content}</p>
        )}
        {own && !item.deleted_at ? (
          <div className="message-actions">
            <button onClick={() => setEditing((prev) => !prev)}>Edit</button>
            <button onClick={() => onDelete(item.id)}>Delete</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Message

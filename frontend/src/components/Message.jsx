import { useState } from 'react'

function Message({ item, own, onEdit, onDelete, labels, locale }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.content)
  const date = new Date(item.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  const submitEdit = async () => {
    const nextValue = draft.trim()
    if (!nextValue || nextValue === item.content) {
      setEditing(false)
      return
    }
    await onEdit(item.id, nextValue)
    setEditing(false)
  }

  return (
    <div className={`message-row ${own ? 'own' : 'other'}`}>
      <div className={`message-bubble ${item.deleted_at ? 'deleted' : ''}`}>
        <div className="message-header">
          <strong>{item.sender}</strong>
        </div>

        {item.attachment_url ? (
          <a
            className="attachment-link"
            href={`${import.meta.env.VITE_API_BASE_URL}${item.attachment_url}`}
            target="_blank"
            rel="noreferrer"
          >
            {item.attachment_name || labels.attachment}
          </a>
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
          <p>{item.content}</p>
        )}

        <div className="message-footer">
          <span>{date}</span>
          {item.edited_at ? <em>{labels.edited}</em> : null}
        </div>

        {own && !item.deleted_at ? (
          <div className="message-actions">
            <button type="button" onClick={() => setEditing((prev) => !prev)}>
              {editing ? labels.cancel : labels.edit}
            </button>
            <button type="button" onClick={() => onDelete(item.id)}>
              {labels.delete}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Message

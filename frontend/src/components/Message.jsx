function Message({ item, own }) {
  const date = new Date(item.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={`message-row ${own ? 'own' : ''}`}>
      <div className="message-bubble">
        <div className="message-header">
          <strong>{item.sender}</strong>
          <span>{date}</span>
        </div>
        <p>{item.message}</p>
      </div>
    </div>
  )
}

export default Message

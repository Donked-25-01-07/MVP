import { useState } from 'react'
import AuthForm from './components/AuthForm'
import MessengerApp from './MessengerApp'

function App() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem('token')
    const username = localStorage.getItem('username')
    return token && username ? { token, username } : null
  })

  const handleAuth = ({ token, username }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('username', username)
    setAuth({ token, username })
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    setAuth(null)
  }

  if (!auth) {
    return <AuthForm onAuth={handleAuth} />
  }

  return <MessengerApp auth={auth} onLogout={logout} />
}

export default App

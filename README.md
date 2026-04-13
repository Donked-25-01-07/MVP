# Verdgram MVP Realtime Messenger

MVP messenger with:
- Frontend: React + Vite
- Backend: FastAPI + WebSocket
- Database: PostgreSQL (Railway-ready)
- DB access: `asyncpg` + raw SQL (no ORM)
- Migrations: Alembic

## Project Structure

- `backend/` - FastAPI app, auth, REST, WebSocket, migrations
- `frontend/` - React app, auth UI, chat UI, themes

## 1) Backend Setup

```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `.env` in `backend/` from `.env.example`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/verdgram
JWT_SECRET=replace_with_strong_secret
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

Run migrations:

```bash
alembic upgrade head
```

Start API:

```bash
uvicorn main:app --reload
```

Backend endpoints:
- `POST /auth/register`
- `POST /auth/login`
- `GET /messages`
- `WS /ws?token=<JWT>`

## 2) Frontend Setup

```bash
cd frontend
npm install
```

Create `.env` in `frontend/` from `.env.example`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_WS_BASE_URL=ws://127.0.0.1:8000
```

Run frontend:

```bash
npm run dev
```

Open the app in browser and:
1. Register or login
2. See loaded history
3. Send message and get realtime updates

## 3) Railway Notes

1. Create PostgreSQL plugin/service on Railway.
2. Copy Railway Postgres URL to backend `DATABASE_URL`.
3. Deploy backend service.
4. Run migrations on Railway environment:
   - `alembic upgrade head`
5. Set frontend `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` to deployed backend URL.

## Smoke Check (completed locally)

- `frontend`: `npm run lint` passed
- `frontend`: `npm run build` passed
- `backend`: `python -m compileall .` passed

To fully verify end-to-end chat, run against a reachable PostgreSQL database and execute `alembic upgrade head`.

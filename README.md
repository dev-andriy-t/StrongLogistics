# 🚛 StrongLogistics — Система оптимізації логістичних маршрутів

[![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19+-61DAFB?logo=react)](https://react.dev)
[![OR-Tools](https://img.shields.io/badge/OR--Tools-CVRP-orange)](https://developers.google.com/optimization)

StrongLogistics — це MVP платформа для **динамічного розподілу ресурсів** та **оптимізації маршрутів доставки** з використанням Google OR-Tools `CVRP` (Capacitated Vehicle Routing Problem) солвера.

Система дозволяє:
- 📦 Відстежувати стан складів та точок доставки в реальному часі
- 🚀 Автоматично оптимізувати маршрути з урахуванням пріоритетів та ємностей
- ⚡ Моделювати форс-мажорні ситуації
- 🗺 Візуалізувати маршрути на інтерактивній карті

---

## 📐 Архітектура

```
┌─────────────────────────────────────────────────────────────────┐
│                       Frontend (React + Vite)                   │
│   ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│   │  Login   │→ │  Dashboard   │→ │  Leaflet Map + Animated  │ │
│   │  Screen  │  │  Sidebar     │  │  Route Polylines         │ │
│   └──────────┘  └──────────────┘  └──────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP/JSON (JWT Bearer Auth)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI + Python)                   │
│   ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│   │  Auth    │  │  REST API    │  │  OR-Tools CVRP Solver    │ │
│   │  (JWT)   │  │  Endpoints   │  │  (Capacitated VRP)       │ │
│   └──────────┘  └──────────────┘  └──────────────────────────┘ │
│                         │                                       │
│                         ▼                                       │
│               ┌──────────────────┐                              │
│               │  In-Memory Store │                              │
│               │  (Warehouses +   │                              │
│               │   Delivery Pts)  │                              │
│               └──────────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Авторизація

Логін: `admin`
Пароль: `stronglogistics2026`

JWT-токен зберігається тільки в React ref (не localStorage) для безпеки.

---

## 📡 API Ендпоінти

| Метод  | Шлях                | Авт. | Тіло запиту                                              | Відповідь                                                                                                      |
|--------|---------------------|------|-----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `POST` | `/api/login`        | ❌   | `{"username": "admin", "password": "stronglogistics2026"}` | `{"access_token": "eyJ...", "token_type": "bearer"}`                                                           |
| `GET`  | `/api/status`       | ❌   | —                                                         | `{"warehouses": [...], "delivery_points": [...]}`                                                              |
| `POST` | `/api/allocate`     | ✅   | —                                                         | `{"route": [...], "total_allocated": 550, "total_distance_km": 89.4, "solver_status": "OPTIMAL", "solve_time_ms": 234, "unserved": [...]}` |
| `POST` | `/api/force-majeure`| ✅   | `{"point_id": 1, "demand": 300, "priority": "critical"}`  | `{"warehouses": [...], "delivery_points": [...]}`                                                              |
| `POST` | `/api/reset`        | ✅   | —                                                         | `{"warehouses": [...], "delivery_points": [...]}`                                                              |
| `GET`  | `/api/nearest`      | ❌   | Query: `?lat=49.25&lng=23.85`                              | `[{"id": 2, "name": "Дрогобич", "distance_km": 28.4, "stock": 400}, ...]`                                     |

---

## 🏗 Початкові дані

### Склади
| ID | Назва     | Lat   | Lng   | Запас |
|----|----------|-------|-------|-------|
| 1  | Львів    | 49.84 | 24.02 | 1000  |
| 2  | Дрогобич | 49.35 | 23.50 | 400   |

### Точки доставки
| ID | Назва     | Lat   | Lng   | Попит | Пріоритет |
|----|----------|-------|-------|-------|-----------|
| 1  | Стрий    | 49.25 | 23.85 | 150   | high      |
| 2  | Борислав | 49.29 | 23.43 | 80    | normal    |
| 3  | Жовква   | 50.06 | 23.97 | 120   | high      |
| 4  | Самбір   | 49.52 | 23.20 | 200   | critical  |

---

## 🚀 Встановлення та запуск

### Backend

```bash
cd backend
pip install fastapi uvicorn ortools python-jose[cryptography] passlib[bcrypt] pydantic
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Фронтенд за замовчуванням підключається до `http://localhost:8000`. Можна змінити через змінну середовища:

```bash
VITE_API_URL=https://your-api.railway.app npm run dev
```

---

## 🌍 Змінні середовища

| Змінна         | Опис                          | За замовчуванням           |
|---------------|-------------------------------|----------------------------|
| `VITE_API_URL` | URL бекенд API (фронтенд)    | `http://localhost:8000`    |
| `PORT`         | Порт для бекенду (Railway)    | `8000`                     |

---

## 🚢 Деплой

### Backend → Railway

```bash
cd backend
railway up
```

Файл конфігурації: `backend/railway.toml`

### Frontend → Vercel

```bash
cd frontend
vercel --prod
```

Не забудьте встановити `VITE_API_URL` у налаштуваннях Vercel.

Файл конфігурації: `frontend/vercel.json`

---

## 🛠 Технології

- **Backend**: Python 3.10+, FastAPI, Google OR-Tools, Pydantic, python-jose, passlib
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, react-leaflet, Leaflet, axios, lucide-react
- **Карта**: CartoDB Dark tiles, анімовані пунктирні маршрути
- **Алгоритм**: CVRP з `PATH_CHEAPEST_ARC` + `GUIDED_LOCAL_SEARCH`, пріоритетні штрафи (`AddDisjunction`), ємне обмеження (`AddDimensionWithVehicleCapacity`)

---

## 📄 Ліцензія

MIT © 2026 StrongLogistics Team 🇺🇦

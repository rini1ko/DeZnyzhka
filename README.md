# DeЗнижка — знижки кав’ярень і ресторанів Львова

Вебсайт, що збирає актуальні знижки та акції кав’ярень і ресторанів центру Львова в одному місці.
Студент за 10 секунд бачить, де сьогодні вигідно випити кави чи пообідати; заклад безкоштовно
залучає клієнтів у «мертві» години.

**Демо:** https://54-89-56-180.sslip.io  ·  **Команда:** Поліна Зайць, Жванко Ярина

## Що вміє (v1)
- Реєстрація та вхід (email + пароль)
- Стрічка знижок з фільтрами: кава / обіди, «діє зараз», день тижня
- Картка закладу: умови, години, адреса, Instagram
- «Вибране» (♡)
- Форма «додати акцію» з обов’язковою датою завершення; прострочені приховуються автоматично
- «Ще діє? Так / Ні»: після 3 голосів «ні» акція ховається
- Лінка на локацію закладу

## Структура
```
backend/    Node.js + Express API (перевірка входу, акції, голосування, вибране)
frontend/   React + Vite
infra/      schema.sql, seed.sql, aws/DEPLOY.md, render.yaml, .env.example
```
Стек: Supabase (Postgres + Auth), AWS (Lambda, S3, CloudFront). Мінімальний бюджет.

## Запуск локально
Потрібен Node 20+.
1. Створіть проєкт на supabase.com. У SQL Editor виконайте `infra/schema.sql`, потім `infra/seed.sql`.
2. Скопіюйте змінні з `infra/.env.example` у `backend/.env` та `frontend/.env` (ключі: Supabase → Project Settings → API).
3. Backend: `cd backend && npm install && npm run dev` (порт 3000)
4. Frontend: `cd frontend && npm install && npm run dev` (http://localhost:5173)

Для швидких тестів вимкніть підтвердження email: Supabase → Authentication → Providers → Email → Confirm email = off.

## Автоімпорт знижок (Telegram)
Скрипт читає публічні Telegram-канали закладів (`https://t.me/s/<канал>`), знаходить пости про знижки
й додає їх як **чернетки** (`approved=false`) з посиланням на першоджерело.
1. Для вже створеної бази виконайте `infra/migrations/002_import_sources.sql`.
2. Впишіть канали в `infra/sources.json` (`place` — точна назва закладу з таблиці `places`).
3. `cd backend && node --env-file=.env scripts/import-telegram.js`
4. Supabase → Table Editor → `deals` → відфільтруйте `approved = false`, перевірте назву й `ends_on`, поставте `approved = true`.
Скрипт не публікує нічого сам: людина перевіряє кожну акцію. Instagram не парситься (закритий API, порушує правила).

## Деплой (AWS)
Frontend: S3 + CloudFront (HTTPS). Backend: AWS Lambda + Function URL (HTTPS). Покроково з усіма
налаштуваннями: [`infra/aws/DEPLOY.md`](infra/aws/DEPLOY.md). Вартість ≈ $0 (безстроковий free tier Lambda та CloudFront).
Альтернатива без AWS: `infra/render.yaml` (Render) для бекенду та Vercel для фронтенду.

## Безпека
`SUPABASE_SERVICE_KEY` лише на бекенді й ніколи не потрапляє в git. Таблиці закриті RLS, дані доступні лише через API.

# Деплой на AWS (мінімальний бюджет)

Архітектура: **CloudFront → S3** (frontend, HTTPS) та **Lambda Function URL** (backend, HTTPS).
Дані й вхід — Supabase. Lambda та CloudFront мають безстроковий безкоштовний ліміт, S3 копійчний.
Регіон для всього: **eu-central-1 (Frankfurt)**. Усе робиться в AWS Console, CLI не потрібен.

## 0. Підготовка акаунта (5 хв)
1. Створіть AWS-акаунт (Free plan), увійдіть у Console.
2. **Billing → Budgets → Create budget**: ліміт $5 з email-сповіщенням. Захист від сюрпризів.

## 1. Backend → Lambda
1. Локально: `cd backend && npm install --omit=dev`
2. Заархівуйте **вміст** папки `backend` (папки `src`, `node_modules` і файл `package.json`) у `backend.zip`.
   Windows PowerShell: `Compress-Archive -Path src,node_modules,package.json -DestinationPath backend.zip`
   Mac/Linux: `zip -r backend.zip src node_modules package.json`
3. Console → **Lambda → Create function** → Author from scratch:
   name `deznyzhka-api`, Runtime **Node.js 20.x**, Architecture arm64.
   Advanced settings → **Enable function URL**, Auth type **NONE**. Create.
4. **Code → Upload from → .zip file** → `backend.zip`. Якщо zip > 50 MB, завантажте через S3.
5. **Code → Runtime settings → Edit → Handler** = `src/lambda.handler`
6. **Configuration → General configuration**: Memory 256 MB, Timeout 15 sec.
7. **Configuration → Environment variables**:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FRONTEND_ORIGIN` (додасте на кроці 3).
8. **Configuration → Function URL** — скопіюйте URL (`https://xxxx.lambda-url.eu-central-1.on.aws`).
   У налаштуваннях Function URL CORS **не вмикайте**: CORS робить сам Express.
9. Перевірка: відкрийте `<function URL>/api/health` → `{"ok":true}`.
   Якщо 403 Forbidden: Configuration → Permissions → Resource-based policy має містити дозволи
   `lambda:InvokeFunctionUrl` та `lambda:InvokeFunction` для Principal `*`.

## 2. Frontend → S3 + CloudFront
1. Створіть `frontend/.env.production`:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_API_URL=<Function URL без / в кінці>
   ```
2. `cd frontend && npm install && npm run build` — з'явиться папка `dist/`.
3. Console → **S3 → Create bucket** (унікальна назва, eu-central-1, **Block all public access = ON**).
   Завантажте **вміст** `dist/` (index.html і папку assets) у корінь бакета.
4. Console → **CloudFront → Create distribution**:
   - Origin: ваш S3 bucket, Origin access: **Origin access control (OAC)** → Create new OAC.
   - Viewer protocol policy: **Redirect HTTP to HTTPS**.
   - Default root object: `index.html`.
   - Web Application Firewall: **Do not enable** (платне).
   - Price class: **Use only North America and Europe**.
5. Після створення CloudFront покаже банер **Copy policy** → відкрийте S3 → Bucket → Permissions →
   Bucket policy → вставте й збережіть.
6. Через 3–5 хв сайт відкриється на `https://dxxxxxxxx.cloudfront.net` — це URL вашого демо.

## 3. З'єднати частини
1. Lambda → Environment variables → `FRONTEND_ORIGIN` = `https://dxxxxxxxx.cloudfront.net` (без / в кінці). Save.
2. Supabase → Authentication → URL Configuration → Site URL = той самий CloudFront URL.

## Оновлення сайту
- Frontend: `npm run build`, завантажити `dist/` у S3 (з заміною), у CloudFront → Invalidations → `/*`.
- Backend: перезібрати `backend.zip` і завантажити в Lambda.

## Орієнтовна вартість
Lambda і CloudFront в межах безстрокового ліміту ($0), S3 для кількох МБ — центи. Бюджет $5 + алерт
захищає від перевищення.

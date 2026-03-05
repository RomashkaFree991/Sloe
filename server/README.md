# Crash Game Server

Мультиплеер сервер для краш-игры на Node.js + Socket.io

## Установка

```bash
cd server
npm install
```

## Запуск

```bash
npm start
```

Сервер запустится на порту `3001`.

## Настройка домена

1. Получи домен или используй IP сервера
2. Установи SSL сертификат (Let's Encrypt / Certbot)
3. Настрой Nginx как reverse proxy

### Nginx конфиг:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

## После настройки

1. Открой `index.html`
2. Найди строку: `const SERVER_URL = 'https://your-server.com:3001';`
3. Замени на свой домен: `const SERVER_URL = 'https://your-domain.com';`

## PM2 (для постоянной работы)

```bash
npm install -g pm2
pm2 start server.js --name crash-server
pm2 save
pm2 startup
```

## Проверка

Открой в браузере: `https://your-domain.com/`

Должен вернуть JSON со статусом игры:
```json
{
  "status": "ok",
  "gameState": {
    "status": "countdown",
    "players": 0,
    "multiplier": 1
  }
}
```

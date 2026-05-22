# Deployment Guide (Contabo VPS)

## Prerequisites

- Ubuntu 22.04+ VPS
- A domain name pointed to your server IP (optional, needed for HTTPS)
- SSH access as root or a sudo user

---

## 1. Install Docker

```bash
apt update && apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

---

## 2. Configure Firewall

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

---

## 3. Clone the Repository

```bash
git clone https://github.com/YOUR/repo.git /opt/ollive
cd /opt/ollive
```

---

## 4. Create Environment File

```bash
cat > .env << 'EOF'
INGESTION_API_KEY="replace-with-a-strong-random-secret"

# Optional: server-side fallback API keys (users can also add keys in the UI)
OPENAI_API_KEY=""
OPENAI_MODELS=""
ANTHROPIC_API_KEY=""
ANTHROPIC_MODELS=""
GEMINI_API_KEY=""
GEMINI_MODELS=""
EOF
```

> `DATABASE_URL` and `APP_URL` are already set inside `docker-compose.yml` and do not need to be in `.env`.

---

## 5. Build and Start

```bash
docker compose up -d --build
```

Check that both containers are healthy:

```bash
docker compose ps
```

The app is now running on port 3000 internally. Continue to step 6 to expose it on port 80.

---

## 6. Install and Configure Nginx

```bash
apt install -y nginx
```

Create the site config. Replace `_` with your domain if you have one:

```bash
cat > /etc/nginx/sites-available/ollive << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering    off;
    }
}
EOF
```

Enable the site and reload:

```bash
ln -s /etc/nginx/sites-available/ollive /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

The app is now accessible at `http://YOUR_SERVER_IP`.

---

## 7. HTTPS with Let's Encrypt (requires a domain)

Point your domain's DNS A record to the server IP, wait for it to propagate, then run:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Certbot will automatically update the Nginx config to serve HTTPS and redirect HTTP to HTTPS.

Test auto-renewal:

```bash
certbot renew --dry-run
```

---

## Useful Commands

```bash
# View live logs
docker compose logs -f app

# Restart the app after a code change
docker compose up -d --build app

# Stop everything
docker compose down

# Stop and wipe the database volume
docker compose down -v

# Open a psql shell
docker compose exec db psql -U ollive -d ollive_ai
```

---

## Updating the App

```bash
cd /opt/ollive
git pull
docker compose up -d --build app
```

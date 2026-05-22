# Deployment Guide (Contabo VPS)

## Prerequisites

- Ubuntu 22.04+ VPS
- A domain name pointed to your server IP (optional, needed for HTTPS)
- SSH access as root or a sudo user

---

## 1. Install Docker

On Ubuntu 24.04/Noble, the Compose v2 package from the Ubuntu repositories is
usually named `docker-compose-v2`, not `docker-compose-plugin`.

```bash
apt update
apt install -y docker.io docker-compose-v2 docker-buildx
systemctl enable --now docker

docker --version
docker compose version
docker buildx version
```

If `docker-compose-v2` is unavailable, install Docker from Docker's official
repository instead:

```bash
apt install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

docker --version
docker compose version
docker buildx version
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

If only the `db` container appears, the app container exited after startup.
Check stopped containers and the app logs:

```bash
docker compose ps -a
docker compose logs --tail=200 app
```

The app is now running on port 3000 internally. Continue to step 6 to expose it on port 80.

---

## 6. Install and Configure Nginx

```bash
apt install -y nginx
```

Create the site config. If you plan to use HTTPS, set `server_name` to your
exact domain. Use `_` only for an IP-only HTTP deployment.

```bash
cat > /etc/nginx/sites-available/ollive << 'EOF'
server {
    listen 80;
    server_name yourdomain.com;

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

Point your domain's DNS A record to the server IP, wait for it to propagate,
and make sure `/etc/nginx/sites-available/ollive` has a matching
`server_name`:

```nginx
server_name yourdomain.com;
```

Then run:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Certbot will automatically update the Nginx config to serve HTTPS and redirect HTTP to HTTPS.

If Certbot successfully receives the certificate but cannot install it because
it cannot find a matching server block, fix `server_name`, reload Nginx, then
install the already-issued certificate:

```bash
sed -i 's/server_name _;/server_name yourdomain.com;/' /etc/nginx/sites-available/ollive
nginx -t && systemctl reload nginx
certbot install --cert-name yourdomain.com
```

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

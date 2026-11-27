# Security

## Isolate apps from the platform

Treat deployed code as untrusted: a vulnerable app, or a dependency's `postinstall` script,
should not get the platform's privileges. Run once on the server:

```bash
sudo /opt/shipyard/scripts/isolate-apps.sh
```

Then add `SHIPYARD_APP_USER=shipyard-apps` and the `PM0_*` lines the script prints to
`/opt/shipyard/.env`, and restart ShipYard (`pm0 restart control-api deploy-engine`).

After that:

- Clones, installs, builds, pre-deploy commands and running apps use the `shipyard-apps`
  account. It has no sudo and can't read the platform's files, `.env` or TLS keys.
- Apps listen on `127.0.0.1` behind Nginx. A firewall rule drops that account's traffic on
  every other interface, so an app port is never public, even if it binds `0.0.0.0`.
- The Control API and Deploy Engine listen on `127.0.0.1` and authenticate each other with a
  token derived from `SECRET`.

Existing apps switch over on their next deploy or rollback.

## Password-protected sites

Turn it on in **Project → Settings → Password protection**. Visitors get a password page on
the site's own domain before anything from the app is served, including its API routes and
webhooks. No redeploy is needed.

- Nginx checks every request with the Control API, so protection only applies in production.
- The password is stored as an Argon2id hash. Changing it signs everyone out.
- Failed attempts are limited to 5 per 10 minutes per visitor.
- If the Control API is down, protected sites return an error instead of opening.
- Uptime checks still work on protected sites.

## Accept traffic only through Cloudflare

Every HTTPS site ShipYard writes includes `/etc/nginx/snippets/shipyard-site-guard*.conf` if
the file exists. Rules placed there apply to every site. For example, to refuse connections
that bypass Cloudflare:

```nginx
# /etc/nginx/conf.d/from-cloudflare.conf
geo $realip_remote_addr $from_cloudflare {
    default 0;
    include /etc/nginx/snippets/cloudflare-ranges.conf;   # one "<range> 1;" per line
}

# /etc/nginx/snippets/shipyard-site-guard.conf
if ($from_cloudflare = 0) { return 444; }
```

Only do this if every ShipYard domain is proxied through Cloudflare (orange cloud); others
would be refused. Keep the ranges up to date from https://www.cloudflare.com/ips. Existing sites
pick up the rule on their next deploy.

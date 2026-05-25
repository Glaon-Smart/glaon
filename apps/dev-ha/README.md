# @glaon/dev-ha

Glaon'un lokal Home Assistant dev fixture'ı. Phase 2 çalışmaları (#7, #10, #12, #13) buna karşı geliştirilir; gerçek bir HA instance'ı olmadan OAuth2 PKCE handshake'i, WebSocket akışı ve service call'ları uçtan uca test edilemez.

Tam runbook (kurulum, onboarding, token alma, sıfırlama, sorun giderme): [docs/home-assistant-dev.md](../../docs/home-assistant-dev.md).

## Hızlı kullanım

```bash
pnpm ha:up      # docker compose up -d
pnpm ha:logs    # canlı log
pnpm ha:down    # durdur (config korunur)
pnpm ha:reset   # durdur + config'i sıfırla (onboarding tekrar)
```

İlk açılışta `http://localhost:8123` üzerinden HA'nın onboarding sihirbazını bir kez tamamla; sonraki `ha:up` çağrıları aynı kullanıcıyı koruyacak.

## Kapsam

- `docker-compose.yml` — `ghcr.io/home-assistant/home-assistant:stable` digest-pin'li.
- `config/configuration.yaml` — `default_config:` + `demo:` platform + Glaon dev origin'leri için CORS.
- `scripts/reset.sh` — runtime artifact'lerini siler, `configuration.yaml`'ı korur.

## Kapsam dışı

- HA Add-on test ortamı — [`addon/`](../../addon/) ayrı akış.
- E2E mock'ları — [#13](https://github.com/toss-cengiz/glaon/issues/13) ve [#358](https://github.com/toss-cengiz/glaon/issues/358) `page.route()` ile gider; bu fixture **dev** içindir.
- Production HA / TLS / sertifika pinning.
- **HA Supervisor endpoint'leri** (`/api/hassio/network/*`) — bu container HA Core, Supervisor'sız. Setup wizard'ın apply step'i (Wi-Fi scan + commit) Supervisor istiyor; macOS dev için UTM HA OS önerilir, kurulum [docs/dev-supervisor.md](../../docs/dev-supervisor.md#live-mode-ha-os-in-utm-602)'de.

Refs #331.

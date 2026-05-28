# HA Supervisor proxy — dev guide

The setup wizard's Network step (#629) + apply step (#597) talk to HA
Supervisor at these endpoints:

- `GET /api/hassio/network/info` — enumerate interfaces, each with its
  `ipv4`/`ipv6` config (`method` / `address` / `gateway` / `nameservers`).
- `GET /api/hassio/network/interface/{iface}/accesspoints` — Wi-Fi scan.
- `POST /api/hassio/network/interface/{iface}/update` — commit Wi-Fi
  credentials and/or `ipv4`/`ipv6` config (the Wi-Fi case is the
  disconnect / handoff moment).
- `GET /api/hassio/host/info` — device host metadata; the Network step
  seeds its hostname field from `data.hostname` (#627).
- `POST /api/hassio/host/options` — set the device hostname. The proxy
  validates `hostname` as an RFC 1123 label and rejects bad input with
  `400 invalid-hostname` before touching the Supervisor (#627).

Two runtime modes:

| Mode                               | Path                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **HA Add-on (production / kiosk)** | The add-on's own nginx proxies `/api/hassio/*` straight to HA Supervisor over Ingress. apps/api is not in the picture.              |
| **Standalone / dev**               | apps/web's Vite dev server proxies `/api/hassio/*` → apps/api (`/hassio/*`). apps/api owns the actual proxy (or returns mock data). |

This doc covers **standalone / dev**.

## Quick start (mock mode — recommended for daily dev)

Mock mode gives you canned payloads: two interfaces with `ipv4`/`ipv6`
config from `GET /network/info`, a 3-network scan from the accesspoints
endpoint, a hostname from `GET /host/info`, and a 200 for any
`POST /network/interface/:iface/update` or `POST /host/options` (a bad
hostname still gets `400`). The wizard's Network + apply steps walk
end-to-end without a real HA running anywhere.

```bash
cp apps/api/.env.example apps/api/.env
# the example already sets HA_SUPERVISOR_MOCK=true
pnpm --filter @glaon/api dev   # apps/api on :8080
pnpm --filter @glaon/web dev   # apps/web on :5173
```

Open `http://localhost:5173`, walk the wizard to the apply step, and
you'll see `GlaonDev-Home`, `GlaonDev-Guest`, `GlaonDev-Office` in the
network list. Picking one and clicking **Save and switch network**
fires the POST; the mock route accepts it and the page reloads onto
the login surface.

The mock list is hard-coded in `apps/api/src/routes/hassio-network.ts`;
extend `MOCK_NETWORK_INFO` if you need more flavours in dev.

## Live mode (against a real HA Supervisor)

Mock mode is enough for most wizard work. Switch to live when you need
to verify the actual network-update path — e.g. credentials really
apply, real APs come back from the scan.

> **Important — user LLTs cannot reach `/api/hassio/*` (#602).** Long-lived access tokens authenticate against HA Core's REST API but the `/api/hassio/*` Supervisor proxy only accepts the Supervisor-internal token (which is injected into add-ons with `hassio_api: true`, never available outside). Any external client (apps/api on a dev box, curl from your laptop, etc.) using an LLT against `http://homeassistant.local:8123/api/hassio/*` will 401 — that's HA by-design, not a misconfig. The two real-Supervisor paths below either run **inside an add-on** (browser wizard via Ingress) or **bounce through one** (apps/api via the dev add-on's LAN port).

### Path 1 (preferred) — Glaon dev add-on on a Pi (#615)

The dev add-on (`addon-dev/`) is a sibling of the production add-on. It runs nginx inside an add-on container with `hassio_api: true`, so it gets the real `$SUPERVISOR_TOKEN`. The browser wizard talks to it via HA Ingress; **apps/api** on your dev box talks to it via a LAN port the add-on exposes specifically for this purpose.

Full Pi install runbook: [`docs/dev-addon-pi.md`](dev-addon-pi.md). Once the add-on is running:

```bash
# apps/api/.env on the dev box
HA_SUPERVISOR_URL=http://homeassistant.local:8099/api/hassio
HA_SUPERVISOR_TOKEN=via-addon-proxy   # placeholder — nginx overrides
```

```bash
# from anywhere on the LAN
curl http://localhost:8080/healthz/supervisor
# { "status": "ok", "mode": "live" }

curl http://localhost:8080/hassio/network/info | jq '.data.interfaces[0].accesspoints | length'
# real AP count from the Pi
```

Security trade-off: anything on the LAN can hit `http://homeassistant.local:8099/api/hassio/network/*` and commit Wi-Fi changes. Dev-only, trusted-LAN posture. Production add-on (`addon/`) doesn't expose any LAN port.

#### Wizard settings → HA Core (`config/*`, #617)

The Wi-Fi handoff above is only one half of "apply". The wizard also collects location, timezone, unit-system, country, language, and the floors/rooms layout — these get pushed into HA Core via `POST /api/setup/apply-ha`, which apps/api translates into HA Core **WebSocket** commands (`config/core/update`, `config/{floor,area}_registry/create` — WS-only, no REST).

Unlike the Supervisor `/api/hassio/*` proxy, HA Core's WebSocket auth **accepts an LLT** (#602). So this path works directly from a dev box against HA Core — no add-on bounce. Set it alongside the supervisor vars:

```bash
# apps/api/.env on the dev box
HA_CORE_URL=http://homeassistant.local:8123
HA_CORE_TOKEN=<long-lived-access-token>   # HA UI → profile → Security
```

```bash
# verify the push end-to-end (after walking the wizard, or by hand)
curl -X POST http://localhost:8080/setup/apply-ha \
  -H 'Content-Type: application/json' \
  -d '{"timezone":"Europe/Istanbul","unitSystem":"metric","country":"TR",
       "layout":{"floors":[{"name":"Ground","rooms":[{"name":"Living"}]}]}}'
# { "ok": true, "steps": [ { "step": "core", "ok": true }, ... ] }
```

Then check HA UI → Settings → System → General (location/timezone/unit-system) and Settings → Areas (the floors/rooms). Both unset → `POST /setup/apply-ha` responds 503. This is a **dev-first** capability ([ADR 0029](adr/0029-apps-api-ha-core-direct-ws.md)); production onboarding routes the same settings through the relay / add-on, not a direct apps/api → HA Core WS.

### Path 2 — UTM HA OS on macOS (browser wizard only)

Use this when you don't have a Pi handy and need to test the browser wizard against a real Supervisor. **apps/api integration via this path is broken** (LLT 401 against `/api/hassio/*`, see the box above); browser path works because HA Ingress generates session-bound tokens for it.

### Why not `apps/dev-ha/`?

The fixture in `apps/dev-ha/` runs **HA Core** (the standalone Python
container) — it intentionally does not expose the Supervisor's
`/api/hassio/*` endpoints. That fixture is for OAuth2 + WebSocket
work where Core is enough; the network-update path needs a real
Supervisor.

You need one of:

1. **Glaon dev add-on on a Pi** (preferred — works for both browser wizard AND apps/api integration; #615 / [docs/dev-addon-pi.md](dev-addon-pi.md)).
2. **HA OS in UTM** (macOS dev — browser wizard only; apps/api integration won't work via this path due to the LLT 401 problem).
3. **HA OS in a VM** (VirtualBox / VMware / Proxmox / Hyper-V).
4. **HA Supervised** running natively on a Linux host.
5. **The actual production add-on** running on a real Home Assistant
   instance — your dev box runs apps/api + apps/web against it over
   the LAN.

### Live mode: HA OS in UTM (#602)

The recommended dev path on macOS.

**1. Spin up HA OS in UTM.** Download the UTM-compatible HA OS image
from <https://www.home-assistant.io/installation/macos>, create a
new UTM VM with it, boot, complete the on-screen onboarding (create
your first user). After onboarding the HA UI lands on
`http://homeassistant.local:8123`.

**2. Mint a long-lived access token (LLT).** In the HA UI:

- Click your user avatar (bottom-left) → **Security** tab.
- Scroll to **Long-lived access tokens** → **Create token**.
- Name it something like `glaon-dev`, copy the token (it's only
  shown once).

**3. Wire `apps/api/.env`.** The example file already carries the
correct URL — paste the token, drop the mock flag if it's set:

```bash
# apps/api/.env
HA_SUPERVISOR_URL=http://homeassistant.local:8123/api/hassio
HA_SUPERVISOR_TOKEN=<paste-the-LLT-here>
# HA_SUPERVISOR_MOCK=true    # leave this commented out for live mode
```

HA Core's `/api/hassio/*` proxy is what forwards apps/api's calls to
the supervisor inside the VM, so we point at port 8123 (HA Core),
not at the supervisor itself.

**4. Restart apps/api** so the new env vars apply:

```bash
pnpm --filter @glaon/api dev
```

**5. Verify reachability.**

```bash
curl http://localhost:8080/healthz/supervisor
# {"status":"ok","mode":"live"}
```

If you get `{ mode: 'live' }` with `status: 'unavailable'` and
`upstreamStatus: 401`, the URL + token are reaching HA but HA is
rejecting the auth on the `/api/hassio/*` path. **This is HA's
by-design behaviour** — the Supervisor REST proxy only accepts the
add-on-injected `$SUPERVISOR_TOKEN`, never an external user LLT —
not a token misconfiguration. For most dev work mock mode is fine;
when you specifically need real Supervisor + real Wi-Fi, switch to
the Glaon dev add-on path (#607,
[docs/dev-addon-pi.md](dev-addon-pi.md)).

If `upstreamStatus` is anything else (404, 502, timeout), the URL is
wrong or `homeassistant.local` doesn't resolve from the host — check
`ping homeassistant.local`.

**6. Walk the wizard.** Open `http://localhost:5173`, walk to the
apply step, you should see the actual Wi-Fi networks the UTM VM can
see. macOS doesn't forward the host's Wi-Fi adapter to UTM by
default; if the AP list is empty, that's the OS-side limitation
(see "Wi-Fi visibility" below) — the API path is still working, it
just has nothing to enumerate.

**7. Pick a network → Save and switch network.** The supervisor
should accept the POST and add the connection to its NetworkManager.
Verify on the HA side:

- HA UI → **Settings** → **System** → **Network** — the new
  connection appears in the list.
- Or, more directly, SSH into HA OS and `nmcli connection show`.

### Live mode: real device on the LAN

Same flow, different URL. Replace `homeassistant.local:8123` with the
device's IP / hostname. Token generation is the same.

## Health probe

`apps/api` exposes `GET /healthz/supervisor` for liveness / dev-loop
diagnostics:

| Response                       | Meaning                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `200 { mode: 'mock' }`         | Mock mode is on; no real supervisor is contacted.                                         |
| `200 { mode: 'live' }`         | Live URL is set and the supervisor's `/network/info` answered 2xx.                        |
| `503 { mode: 'live' }`         | Live URL is set but the supervisor didn't respond. Check the token + URL.                 |
| `503 { mode: 'unconfigured' }` | Neither mock nor URL is configured. The wizard's apply step will land on its error retry. |

## Wi-Fi visibility inside Docker (open question)

Even in live mode, getting the supervisor to enumerate _real_ Wi-Fi
APs from a Docker container is non-trivial. Three plausible paths:

1. **Privileged + host network.** Run HA with `--network host
--privileged --cap-add NET_ADMIN`. The supervisor sees the host's
   wifi adapter on Linux. Docker Desktop on macOS / Windows doesn't
   forward Wi-Fi adapters to containers, so this only works on Linux.
2. **D-Bus mock for NetworkManager.** Inject a fake NetworkManager via
   a D-Bus mock so the supervisor returns a deterministic AP list.
   Best for CI / Playwright; takes effort to set up.
3. **Manual SSID injection.** Skip the scan; type the SSID + password
   manually in the wizard (the apply step doesn't ship a manual-SSID
   input yet — sister issue tracks it). Then verify the commit path
   against a real HA + NM.

For now, mock mode is the recommended default. The above paths exist
when you specifically need to test against a real supervisor.

## Security

The `/hassio/*` proxy on apps/api is **not gated by `requireSession`**
on purpose — the wizard runs before any user account exists. CORS
(allow-list in `WEB_ORIGINS`) and the dev-only nature of standalone
mode are the only barriers.

Don't expose this route from a production apps/api. Production
deployments either:

- Run the wizard inside the HA Add-on, where nginx proxies these
  paths directly to the supervisor and apps/api is never in the path.
- Don't run the wizard at all (the device is already configured).

## Refs

- Tracking issues: #598 (proxy + mock), #602 (UTM HA OS setup).
- Sister wizard collapse: #597 / PR #599.
- Persistence + crypto wrap: #595 / PR #601.
- Setup wizard apply step: `apps/web/src/features/setup/apply/`.
- HA Supervisor network API:
  <https://developers.home-assistant.io/docs/api/supervisor/endpoints/#network>
- HA dev fixture (Core, not Supervisor): `apps/dev-ha/` — for
  OAuth2 + WebSocket work; for the network endpoints use UTM HA OS
  (see "Live mode" above).

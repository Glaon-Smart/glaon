# HA Supervisor proxy — dev guide

The setup wizard's apply step (#597) talks to HA Supervisor at two
endpoints:

- `GET /api/hassio/network/info` — enumerate Wi-Fi access points.
- `POST /api/hassio/network/wlan0/update` — commit the chosen SSID +
  password (this is the disconnect / handoff moment).

Two runtime modes:

| Mode                               | Path                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **HA Add-on (production / kiosk)** | The add-on's own nginx proxies `/api/hassio/*` straight to HA Supervisor over Ingress. apps/api is not in the picture.              |
| **Standalone / dev**               | apps/web's Vite dev server proxies `/api/hassio/*` → apps/api (`/hassio/*`). apps/api owns the actual proxy (or returns mock data). |

This doc covers **standalone / dev**.

## Quick start (mock mode — recommended for daily dev)

Mock mode gives you a canned 3-network payload from `GET /network/info`
and accepts any `POST /network/:iface/update` with a 200. The wizard's
apply step walks end-to-end without a real HA running anywhere.

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

### Prerequisites

The standard HA Core container (the one in `apps/dev-ha/`) **does not
expose the supervisor endpoints**. You need either:

1. **HA Supervised** running natively on a Linux host (full supervisor
   - Docker + NetworkManager stack).
2. **HA OS in a VM** (e.g. VirtualBox / UTM / VMware).
3. **The actual production add-on** running on a real Home Assistant
   instance — your dev box just runs apps/api + apps/web against it.

Inside any of these, the supervisor's HTTP API lives at
`http://supervisor` (DNS resolves inside the supervisor's Docker
network). From outside the supervisor container, you typically need
to expose / port-forward.

### Token

The supervisor expects a **long-lived access token** as `Authorization:
Bearer <token>`. Inside an add-on the supervisor mints one automatically
via the `SUPERVISOR_TOKEN` env var; for external dev you generate one
manually:

1. Open HA web UI → user profile → "Long-lived access tokens" → Create.
2. Copy the token into `apps/api/.env`:

   ```bash
   HA_SUPERVISOR_URL=http://supervisor.local:4357/network   # or wherever
   HA_SUPERVISOR_TOKEN=eyJ0eXAi...                          # the LLT
   ```

3. Drop `HA_SUPERVISOR_MOCK` (or set it to `false`).

Restart `apps/api`. Hit `http://localhost:8080/healthz/supervisor` —
should return `{ status: 'ok', mode: 'live' }`.

### Verifying a commit actually applied

After clicking **Save and switch network** in the wizard, the
supervisor's NetworkManager should have a new connection. Exec into
the HA container and check:

```bash
docker exec -it homeassistant nmcli connection show
docker exec -it homeassistant nmcli connection show <ssid>
```

If `glaon.local` resolves on your home network, opening
`http://glaon.local` should land you on the wizard's post-setup
surface (login screen).

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

- Open issue: #598.
- Sister wizard collapse: #597 / PR #599.
- Setup wizard apply step: `apps/web/src/features/setup/apply/`.
- HA Supervisor network API:
  <https://developers.home-assistant.io/docs/api/supervisor/endpoints/#network>
- HA dev fixture (Core, not Supervisor): `apps/dev-ha/`.

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

### Why not `apps/dev-ha/`?

The fixture in `apps/dev-ha/` runs **HA Core** (the standalone Python
container) — it intentionally does not expose the Supervisor's
`/api/hassio/*` endpoints. That fixture is for OAuth2 + WebSocket
work where Core is enough; the network-update path needs a real
Supervisor.

You need one of:

1. **HA OS in UTM** (macOS dev — easiest path; covered below).
2. **HA OS in a VM** (VirtualBox / VMware / Proxmox / Hyper-V).
3. **HA Supervised** running natively on a Linux host.
4. **The actual production add-on** running on a real Home Assistant
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

If you get `{ mode: 'live' }` with `status: 'unavailable'`, the
URL or token is wrong (or `homeassistant.local` doesn't resolve from
the host — check `ping homeassistant.local`).

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

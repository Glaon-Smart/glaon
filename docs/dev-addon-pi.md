# Glaon dev add-on — Raspberry Pi install

Bu doküman, [`addon-dev/`](../addon-dev/) klasöründeki **dev-only** Glaon add-on'unu bir Raspberry Pi üzerinde çalışan Home Assistant OS instance'ına yükleme adımlarını anlatır. Amaç: setup wizard'ın apply step'ini (#597) gerçek HA Supervisor + gerçek Wi-Fi adapter ile uçtan uca test etmek.

> Bu add-on **production değildir**. Production add-on için bkz. [`addon/`](../addon/). İki add-on'un slug'ları farklıdır (`glaon` vs `glaon_dev`) ve aynı HA instance'ında birlikte yaşayabilirler.

## Neden ayrı bir dev add-on?

Glaon'un harici (laptop'tan) HA Supervisor REST endpoint'lerine erişmesi mümkün değil: long-lived access token (LLT) HA Core API'sine yeter ama `/api/hassio/*` proxy'sine 401 döner. HA'nın by-design davranışı — Supervisor REST endpoint'leri yalnızca **add-on container'ı içinden** `$SUPERVISOR_TOKEN` ile erişilebilir. Detay: [docs/dev-supervisor.md](dev-supervisor.md#health-probe) + #602 tartışması.

Üretim add-on'u (`addon/`) [ADR 0026](adr/0026-apps-api-delivery-hosted.md) gereği Supervisor-blind: `hassio_api: false`. Bu dev add-on tek bir konfigürasyon değişikliğiyle (`hassio_api: true`) bu duvarı aşar, nginx içinde `/api/hassio/network/*` → `http://supervisor/network/*` proxy'si kurar ve `$SUPERVISOR_TOKEN`'ı boot anında `Authorization: Bearer` başlığına yerleştirir.

## Ön koşullar

- Raspberry Pi (3B+ veya üstü) üzerinde HA OS kurulu, ağda erişilebilir (örn. `homeassistant.local:8123` veya `http://<pi-ip>:8123`).
- HA UI'da admin yetkili bir kullanıcın var.
- Geliştirme makinende:
  - Bu repo clone'lu.
  - `pnpm install` koşulmuş.
  - Pi'ye **SSH erişimi** (HA Community SSH add-on'u veya HA OS'un kendi `ha` CLI'sı — aşağıda iki path da var).

## 1. Add-on bundle'ını build et

Dev add-on `apps/web` static dist'ini içerir. Build:

```bash
pnpm build:addon-dev
```

Çıktı: `addon-dev/dist/` dolar. Bu klasör `.gitignore`'da, commit edilmez.

## 2. Add-on kaynaklarını Pi'ye kopyala

İki yaygın yol var. Hangisini kullanırsan kullan, hedef path **`/addons/local/glaon_dev/`** olmalı (HA Supervisor `local/` prefix'i ile local add-on'ları keşfeder; klasör adı manifest'teki `slug` ile birebir eşleşmeli).

### Yol A — Samba add-on (en hızlı)

1. HA UI → Settings → Add-ons → Add-on Store → **Samba share** kur + başlat.
2. macOS Finder → Cmd-K → `smb://homeassistant.local` → mount.
3. `addon-dev/` içeriğini (sadece içeriğini, klasörün kendisini değil) `addons/local/glaon_dev/` altına kopyala:

   ```bash
   rsync -av --delete addon-dev/ /Volumes/addons/glaon_dev/
   ```

   `dist/` dahil tüm klasörler kopyalanmalı.

### Yol B — SSH + rsync

1. HA UI → Settings → Add-ons → **Advanced SSH & Web Terminal** add-on (community, "Protection mode" KAPALI lazım — host'a `/addons/` erişimi için).
2. Public key'ini add-on config'ine ekle.
3. Yerel makinenden:

   ```bash
   rsync -av --delete -e "ssh -p 22222" \
     addon-dev/ root@homeassistant.local:/addons/local/glaon_dev/
   ```

   Port `22222` SSH add-on'un default'u; UI'daki seçimine göre değiştir.

## 3. Supervisor'a add-on'u tanıt

Pi'de (SSH veya `ha` CLI üzerinden):

```bash
ha addons reload
```

Sonrasında HA UI → Settings → Add-ons → **Add-on Store** → sayfa sonunda **"Local add-ons"** bölümünde **Glaon (dev)** görünmeli.

## 4. Install + start

UI üzerinden:

1. **Glaon (dev)** kartına tıkla → **Install**. İlk install Pi üzerinde Docker image'ı **lokal olarak build eder** (~1-3 dakika; nginx + gettext apk install adımları log'da görünür).
2. Install bittiğinde **Start** bas.
3. **Log** sekmesini aç — şunu görmelisin:

   ```
   [run.sh] Rendering nginx config with Supervisor token...
   [run.sh] Starting nginx on :8099...
   ```

   `FATAL: SUPERVISOR_TOKEN is not set` görünürse `config.yaml` içinde `hassio_api: true` doğrulanmamış demektir — manifest'i kontrol et.

## 5. Open Web UI

HA UI → Add-on sayfasında **OPEN WEB UI** butonuna bas. Wizard, Ingress URL'i üzerinden açılır (HA kullanıcı oturumu kontrolünde — harici port yok).

## 6. Doğrulama: gerçek Wi-Fi handoff

1. Wizard'ı **Apply** step'ine kadar yürüt (Home Overview → Layout → Security → Apply).
2. Apply step Wi-Fi network listesini load ederken `/api/hassio/network/info`'ya gider — bu istek dev add-on'un nginx'inden Supervisor'a forward edilir.
3. **Pi'nin gerçek Wi-Fi tarama sonuçlarını** görmelisin (mock listesi değil — `GlaonDev-*` SSID'ler **görünmemeli**). Pi'ye fiziksel olarak hangi AP'ler erişilebiliyorsa onlar görünür.
4. Bir SSID seç, password gir, **Save and switch network** bas.
5. POST `/api/hassio/network/wlan0/update` Supervisor'a forward edilir, NetworkManager yeni connection'ı NM config'ine yazar.

### Pi tarafında doğrulama

SSH üzerinden:

```bash
ha network info
# veya
ssh root@homeassistant.local -p 22222 "nmcli connection show"
```

Yeni eklenen connection listede görünmeli.

## Sorun giderme

| Belirti                                        | Olası neden                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Local add-ons` bölümünde Glaon (dev) yok      | `addons/local/glaon_dev/` path'i yanlış (slug eşleşmiyor), `ha addons reload` koşulmamış, ya da `config.yaml` parse hatası var. `ha addons logs glaon_dev` (install öncesi yok ama logs panel) yerine `ha supervisor logs` bakmak gerekebilir. |
| Install başarısız: "BUILD_FROM not found"      | Pi mimarisi `aarch64` olmalı — `build.yaml` zaten her iki arch için image map'liyor. Pi'de `uname -m` ile doğrula.                                                                                                                             |
| Log'da `FATAL: SUPERVISOR_TOKEN is not set`    | `config.yaml`'da `hassio_api: true` eksik veya yanlış scope. Manifest'i doğrula, add-on'u kaldırıp tekrar install et.                                                                                                                          |
| Wi-Fi listesi boş veya mock SSID'ler görünüyor | Mock'a düşmüş — apps/web `VITE_APP_MODE=ingress` ile build edilmemiş olabilir. Build script'ini kontrol et (`apps/web/.env.production`).                                                                                                       |
| `/api/hassio/network/info` 502                 | nginx Supervisor'a ulaşamıyor. `ha network info` çalışıyor mu? Çalışmıyorsa Supervisor'ın kendisi sorunlu. Çalışıyorsa add-on'un network ayarları (`host_network: false` doğru) gözden geçirilmeli.                                            |

## Güvenlik notları

- Bu add-on `hassio_api: true` ile çalışır, yani `$SUPERVISOR_TOKEN`'a sahiptir. Token Supervisor'ın tüm REST endpoint'lerine erişim verir — nginx config bu yetkiyi **yalnızca `/network/*` prefix'i için** delege eder. Başka path'leri proxy'lemiyoruz; bu kasıtlı.
- Add-on Ingress üzerinden çalışır, harici port açmaz. Erişim HA kullanıcı oturumuyla gate'lidir.
- Wizard akışı bu add-on içinde **authentication gerektirmez** — kullanıcı zaten HA'ya login olarak Ingress'e ulaşmıştır. Üretim wizard akışı (cloud-relay add-on) farklı bir auth modeline sahip.
- Production add-on'unu (`addon/`) bu add-on'a dönüştürmeye **kalkışma**. Production manifest'i [ADR 0026](adr/0026-apps-api-delivery-hosted.md) gereği Supervisor-blind kalmalı.

## Refs

- #607 — bu add-on'un tracking issue'su.
- #597 — wizard collapse (Apply step).
- #598 / #600 — Supervisor proxy + mock mode (apps/api tarafı).
- #602 — UTM HA OS denemesi (user-LLT 401 burada teşhis edildi).
- [docs/dev-supervisor.md](dev-supervisor.md) — mock mode + (mostly-broken) LLT live mode.
- [ADR 0026](adr/0026-apps-api-delivery-hosted.md) — apps/api delivery model.
- HA local add-on geliştirme: <https://developers.home-assistant.io/docs/add-ons/tutorial>.

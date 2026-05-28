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
2. macOS Finder → Cmd-K → `smb://homeassistant.local` → mount. macOS bunu `/Volumes/addons/` altına bağlar.
3. **Dikkat — path doğru olmalı:** Samba share root'u Pi'de `/addons/` dizinine eşittir. HA Supervisor yalnızca **`/addons/local/`** altındaki dev add-on'ları tarar. Yani Mac'teki hedef path şu:

   ```
   /Volumes/addons/local/glaon_dev/
   ```

   Klasör adı (`glaon_dev`) manifest'teki `slug` ile birebir eşleşmeli. `/local/` segmentini unutursan Supervisor add-on'u görmez (eski install'lar varsa kafa karıştırır — değişiklikler yeni path'e ulaşmaz).

4. macOS → Samba rsync'inde `.DS_Store` + `renameat` patlamalarını engellemek için aşağıdaki flag setini kullan (varsayılan `rsync -av` macOS-SMB üzerinde patlar):

   ```bash
   rsync -rltDv --delete \
     --exclude='.DS_Store' --exclude='._*' --exclude='.AppleDouble' \
     --no-perms --no-owner --no-group \
     addon-dev/ /Volumes/addons/local/glaon_dev/
   ```

   `-rltDv` (recursive + symlinks + times + devices, **perms/owner/group YOK** — Samba bu syscall'ları reddediyor).
   `dist/` dahil tüm klasörler kopyalanmalı.

### Yol B — SSH + rsync

1. HA UI → Settings → Add-ons → **Advanced SSH & Web Terminal** add-on (community, "Protection mode" KAPALI lazım — host'a `/addons/` erişimi için).
2. **Add-on config'inde mutlaka** ya `ssh.password` ya da `ssh.authorized_keys` set'le; aksi halde add-on `FATAL: Configuration of this app is incomplete` ile başlamaz. SSH public key tercih edilir:

   ```yaml
   ssh:
     username: root
     password: ''
     authorized_keys:
       - ssh-ed25519 AAAAC3... # ~/.ssh/id_ed25519.pub satırın
     sftp: true
   ```

3. Yerel makinenden:

   ```bash
   rsync -rltDv --delete -e "ssh -p 22222" \
     --exclude='.DS_Store' --exclude='._*' \
     addon-dev/ root@homeassistant.local:/addons/local/glaon_dev/
   ```

   Port `22222` SSH add-on'un default'u; UI'daki seçimine göre değiştir.

## 3. Supervisor'a add-on'u tanıt

Pi'de (SSH veya HA Terminal add-on üzerinden):

```bash
ha apps reload    # eski form: `ha addons reload` — hâlâ çalışır ama deprecated
```

Sonrasında HA UI → Settings → Add-ons → **Add-on Store** → sayfa sonunda **"Local add-ons"** bölümünde **Glaon (dev)** görünmeli.

## 4. Install + start

UI üzerinden:

1. **Glaon (dev)** kartına tıkla → **Install**. İlk install Pi üzerinde Docker image'ı **lokal olarak build eder** (~1-3 dakika; nginx + gettext apk install adımları log'da görünür).
2. Install bittiğinde **Start** bas.
3. **Log** sekmesini aç — şunu görmelisin (bashio'nun varsayılan log formatı, `[HH:MM:SS] INFO:` prefix'iyle):

   ```
   [hh:mm:ss] INFO: Rendering nginx config with Supervisor token...
   [hh:mm:ss] INFO: Starting nginx on :8099...
   ```

   `FATAL: SUPERVISOR_TOKEN is not set` görünürse `config.yaml` içinde `hassio_api: true` doğrulanmamış demektir — manifest'i kontrol et.

> **Mevcut bir install'ı güncellerken:** sadece rsync + start yetmez; image cache, AppArmor profili ve `hassio_role` gibi manifest değişiklikleri yenilenmez. CLI'dan temiz kur:
>
> ```bash
> ha apps uninstall local_glaon_dev    # mevcut container + image atılır
> ha apps reload                       # /addons/local/ tekrar taranır
> ha apps install local_glaon_dev      # yeni source ile fresh image build
> ha apps start local_glaon_dev
> ```
>
> `ha apps rebuild local_glaon_dev` da kullanılabilir ama manifest değişikliklerinde (apparmor flag, hassio_api, **hassio_role**) uninstall-reinstall daha güvenli.

## 5. Open Web UI

HA UI → Add-on sayfasında **OPEN WEB UI** butonuna bas. Wizard, Ingress URL'i üzerinden açılır (HA kullanıcı oturumu kontrolünde — Ingress'in kendi auth gate'i devrede).

> **LAN portu (#615):** Add-on aynı zamanda nginx'i `8099/tcp` üzerinden LAN'a açar. Bu port **apps/api'nın kendi `/hassio/*` route'unu Pi'deki Supervisor'a yönlendirebilmesi için** var — dev box'tan `HA_SUPERVISOR_URL=http://homeassistant.local:8099/api/hassio` ile kullanılır. Ingress yerine LAN portu kullanıldığında HA oturum kontrolü devreden çıkar; nginx side'ında auth yok — yani LAN'daki herhangi bir cihaz `/api/hassio/network/*` çağırabilir. **Sadece güvenilir LAN için.** Production add-on (`addon/`) bu portu açmaz. Detay: [docs/dev-supervisor.md](dev-supervisor.md#path-1-preferred--glaon-dev-add-on-on-a-pi-615).

## 6. Doğrulama: gerçek Wi-Fi handoff

1. Wizard'ı **Apply** step'ine kadar yürüt (Home Overview → Layout → Security → Apply).
2. Apply step önce `/api/hassio/network/info`'dan wireless interface'i (wlan0) keşfeder, sonra `/api/hassio/network/interface/wlan0/accesspoints`'ten AP listesini çeker (#622) — ikisi de dev add-on'un nginx'inden Supervisor'a forward edilir.
3. **Pi'nin gerçek Wi-Fi tarama sonuçlarını** görmelisin (mock listesi değil — `GlaonDev-*` SSID'ler **görünmemeli**). Pi'ye fiziksel olarak hangi AP'ler erişilebiliyorsa onlar sinyal gücüyle görünür.
4. Bir SSID seç, password gir (açık ağsa boş bırak), **Save and switch network** bas.
5. POST `/api/hassio/network/interface/wlan0/update` Supervisor'a forward edilir, NetworkManager yeni connection'ı NM config'ine yazar.

### Pi tarafında doğrulama

SSH üzerinden:

```bash
ha network info
# veya
ssh root@homeassistant.local -p 22222 "nmcli connection show"
```

Yeni eklenen connection listede görünmeli.

## Sorun giderme

| Belirti                                                             | Olası neden                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Local add-ons` bölümünde Glaon (dev) yok                           | `addons/local/glaon_dev/` path'i yanlış (en sık sebep: rsync hedefinde `/local/` segmenti unutulmuş — yukarı bak), slug eşleşmiyor, `ha apps reload` koşulmamış, ya da `config.yaml` parse hatası var. `ha supervisor logs` parse hatalarını gösterir.                                                                                      |
| Install başarısız: "BUILD_FROM not found"                           | Pi mimarisi `aarch64` olmalı — `build.yaml` zaten her iki arch için image map'liyor. Pi'de `uname -m` ile doğrula.                                                                                                                                                                                                                          |
| Log'da `FATAL: SUPERVISOR_TOKEN is not set`                         | `config.yaml`'da `hassio_api: true` eksik veya yanlış scope. Manifest'i doğrula, add-on'u kaldırıp tekrar install et.                                                                                                                                                                                                                       |
| Log'da `/bin/sh: can't open '/init': Permission denied`             | Eski (#609 öncesi, AppArmor on) build'de çıkıyordu. Şimdi `apparmor: false` dev variant'ta — bu hatayı görüyorsan Pi'deki kaynaklar hâlâ eski. `head -1 /addons/local/glaon_dev/rootfs/run.sh` çıktısı `#!/usr/bin/with-contenv bashio` olmalı; değilse rsync hedefini + `ha apps rebuild` adımını tekrarla.                                |
| Log'da `/init: exec: line 45: s6-overlay-suexec: Permission denied` | Aynı kök sebep — AppArmor s6-overlay v3 zincirini engelliyor. #611 ile `apparmor: false` yapıldı; eski install'ı silip yeniden install et (`ha apps uninstall local_glaon_dev && ha apps reload && ha apps install local_glaon_dev`). Rebuild tek başına AppArmor profile'ını yenilemiyor.                                                  |
| `App glaon_dev does not exist` (CLI)                                | HA CLI local add-on'ları `local_<slug>` prefix'iyle saklıyor. `ha apps rebuild local_glaon_dev` (önekli) doğru komut.                                                                                                                                                                                                                       |
| `403 Forbidden` (gövde `403: Forbidden`) accesspoints/update'te     | Add-on rolü yetersiz (#622). HA Supervisor `/network/.+` endpoint'lerini `manager`/`admin` rolüne kapatıyor; varsayılan rol yalnız `GET /network/info`'ya izin verir. `config.yaml`'da `hassio_role: admin` olduğundan emin ol; manifest değiştiğinde uninstall + reload + install ile yeniden kur (rebuild rol değişikliğini almayabilir). |
| Wi-Fi listesi boş ama HA UI ağları buluyor                          | Eski (#622 öncesi) build: AP'ler `/network/info`'dan okunuyordu ama Supervisor onları orada döndürmüyor. Düzeldi — tarama artık `/network/interface/{iface}/accesspoints`'ten gelir. Pi'deki kaynakları güncelle + yeniden install et.                                                                                                      |
| `/api/hassio/network/info` 502                                      | nginx Supervisor'a ulaşamıyor. `ha network info` çalışıyor mu? Çalışmıyorsa Supervisor'ın kendisi sorunlu. Çalışıyorsa add-on'un network ayarları (`host_network: false` doğru) gözden geçirilmeli.                                                                                                                                         |

## Güvenlik notları

- Bu add-on `hassio_api: true` ile çalışır, yani `$SUPERVISOR_TOKEN`'a sahiptir. Token Supervisor'ın tüm REST endpoint'lerine erişim verir — nginx config bu yetkiyi **yalnızca `/network/*` prefix'i için** delege eder. Başka path'leri proxy'lemiyoruz; bu kasıtlı.
- Add-on Ingress üzerinden çalışır, harici port açmaz. Erişim HA kullanıcı oturumuyla gate'lidir.
- Wizard akışı bu add-on içinde **authentication gerektirmez** — kullanıcı zaten HA'ya login olarak Ingress'e ulaşmıştır. Üretim wizard akışı (cloud-relay add-on) farklı bir auth modeline sahip.
- **AppArmor bu dev variant'ta kapalı** (`apparmor: false`, #609 sonucu). HA base image'ın s6-overlay v3 bootstrap zinciri pratik olarak whitelist'lenemiyor; her path bir sonraki denial'ı açığa çıkarıyor. Container hâlâ Docker'ın default seccomp + namespace isolation + Supervisor'ın network ACL'leri altında. Bu kabul edilebilir çünkü add-on dev-only ve sadece geliştiricinin kendi Pi'sinde çalışıyor. Production add-on (`addon/`) hâlâ `apparmor: true` ile sıkı profil altında — orada güvenlik kritik.
- Production add-on'unu (`addon/`) bu add-on'a dönüştürmeye **kalkışma**. Production manifest'i [ADR 0026](adr/0026-apps-api-delivery-hosted.md) gereği Supervisor-blind kalmalı.

## Refs

- #607 — bu add-on'un tracking issue'su.
- #597 — wizard collapse (Apply step).
- #598 / #600 — Supervisor proxy + mock mode (apps/api tarafı).
- #602 — UTM HA OS denemesi (user-LLT 401 burada teşhis edildi).
- [docs/dev-supervisor.md](dev-supervisor.md) — mock mode + (mostly-broken) LLT live mode.
- [ADR 0026](adr/0026-apps-api-delivery-hosted.md) — apps/api delivery model.
- HA local add-on geliştirme: <https://developers.home-assistant.io/docs/add-ons/tutorial>.

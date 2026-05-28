# ADR 0029 — Setup wizard ayar push'u: apps/api → HA Core doğrudan WebSocket (dev-first)

- **Durum:** Accepted
- **Karar tarihi:** 2026-05-28
- **Karar verenler:** @toss-cengiz
- **İlgili konular:** [ADR 0016](0016-ha-ws-transport.md), [ADR 0026](0026-apps-api-delivery-hosted.md), [ADR 0028](0028-device-config-state.md), [issue #617](https://github.com/Glaon-Smart/glaon/issues/617), [issue #602](https://github.com/Glaon-Smart/glaon/issues/602), [issue #607](https://github.com/Glaon-Smart/glaon/issues/607)

## Bağlam

Setup wizard'ın apply step'i (#597) kullanıcının evini tarif eden ayarları topluyor: konum (lat/lon), saat dilimi, ölçü sistemi, ülke, dil ve çok katlı layout (floors/rooms). Wi-Fi handoff'u (#594/#607) artık gerçek HA Supervisor'a iniyor, ama geri kalan ayarlar yalnızca tarayıcının `localStorage`'ında (`glaon.device-config`, [ADR 0028](0028-device-config-state.md)) duruyordu — Home Assistant'a hiç ulaşmıyorlardı. Wizard'da tarif edilen ev, HA tarafında yapılandırılmıyordu.

Bu ayarları HA'ya yazmak için iki teknik kısıt var:

1. **HA Core config + registry yazımları WebSocket-only.** `config/core/update`, `config/floor_registry/create`, `config/area_registry/create` komutlarının REST karşılığı yok.
2. **Supervisor REST proxy (`/api/hassio/*`) user LLT kabul etmiyor** (#602) — yalnızca add-on'a inject edilen Supervisor token'ı geçerli. Ama **HA Core'un kendi WebSocket auth'u LLT kabul ediyor** (HA Core `/api/` LLT ile 200 dönüyor).

[ADR 0026](0026-apps-api-delivery-hosted.md) `apps/api`'ı hosted servis olarak konumlandırdı; HA'ya **cloud relay** üzerinden bağlanması bekleniyor, doğrudan değil. Dolayısıyla "apps/api → HA Core doğrudan WS" yeni bir desen ve ADR 0026'nın production modelinden sapıyor.

Göz önünde bulundurulan alternatifler:

- **Seçenek A — Tarayıcı (apps/web) HaClient + DirectWsTransport ile doğrudan HA'ya yazar.** Reddedildi: wizard login-öncesi çalışıyor; standalone modda tarayıcının HA WS token'ı yok, Ingress modda token ephemeral ve cookie-bağımlı. Kullanıcı da "API yapsın" dedi.
- **Seçenek B — apps/api'ı add-on container'ı içinde çalıştırıp Supervisor token ile yaz.** Reddedildi: ADR 0026 apps/api'ı hosted tutuyor; Mongo + Node'u add-on'a paketlemek ağır ve frozen kararla çelişiyor.
- **Seçenek C — Production relay yolu.** Doğru uzun-vade modeli ama relay backend henüz hazır değil (#345 ailesi); dev döngüsünü bloklar.
- **Seçenek D (seçilen) — apps/api HA Core'a doğrudan WS açar, LLT ile auth olur. Dev-first.**

## Karar

**Setup ayar push'u, dev/standalone runtime'da `apps/api`'ın HA Core'a doğrudan WebSocket açıp long-lived access token ile auth olarak `config/*` komutlarını göndermesiyle yapılır.** Bu bilinçli olarak dev-first bir capability'dir; production onboarding'i relay / add-on üzerinden gider (ayrı epic) ve bu doğrudan-WS yolu production modeli olarak görülmez.

Teknik detaylar:

- **Mapping `@glaon/core`'da, pure.** `ha/setup-commands.ts` device-config alt kümesini sıralı bir plana çevirir (`buildHaSetupPlan`). `imperial → us_customary`, locale → HA `language` primary subtag dönüşümleri burada. WS frame tipleri (`config/core/update`, `config/{floor,area}_registry/create`) `HaOutboundFrame` union'ına eklendi.
- **HaClient yeniden kullanılır (ADR 0016).** Transport-agnostic client + auth handshake + id korelasyonu hazır. apps/api Node-tarafı bir transport sağlar (`apps/api/src/ha/node-ws-transport.ts`, Node 22 global `WebSocket`), çünkü core'un `DirectWsTransport`'u DOM tipleri (`MessageEvent<T>`, `CloseEvent`) kullanıyor ve Node tsconfig'inde yok. Bu, package-boundary kuralına uyar: platform-spesifik transport `apps/*`'ta yaşar. `DirectWsTransport` artık `@glaon/core/ha` barrel'ından değil, `@glaon/core/ha/direct-ws` subpath'inden import edilir — Node tüketicisi DOM bağımlılığı miras almaz.
- **Route `POST /setup/apply-ha`, unauthenticated.** Wizard login-öncesi olduğu için hassio-network proxy'siyle aynı duruş: `requireSession` yok, CORS + dev-only mod bariyer. `HA_CORE_URL` + `HA_CORE_TOKEN` set değilse 503; WS açılamazsa 502; per-step sonuç (`{ ok, steps }`).
- **Best-effort, per-step.** Her komut, önceki başarısız olsa bile çalışır. Floor-create başarısızsa room'lar yine yaratılır (floor'suz — eski HA'da floor registry yoksa graceful degrade). Tarayıcı tarafı: HA push **Wi-Fi handoff'tan ÖNCE** (non-destructive sırada) çalışır; hard failure'da ceremony abort edilir ve Wi-Fi switch hiç tetiklenmez.
- **Konfigürasyon.** `HA_CORE_URL` (HA Core HTTP base, scheme ws/wss'e çevrilir) + `HA_CORE_TOKEN` (LLT). `HA_SUPERVISOR_URL` (add-on proxy) ile ayrı.

## Sonuçlar

### Olumlu

- Wizard'ın topladığı ayarlar artık gerçek HA'ya iniyor — "evi gerçekten yapılandırma" hikayesi tamam.
- HA Core WS auth LLT kabul ettiği için dev box'tan doğrudan çalışır; add-on bounce gerekmez (Wi-Fi push'un aksine).
- HaClient + transport-agnostic mimari (ADR 0016) gerçek bir ikinci tüketiciyle (Node) doğrulandı; `request()`'in distributive-Omit tip hatası bu sırada düzeltildi.
- Mapping pure + unit-test'li; route fake client ile test'li.

### Olumsuz / ödenecek bedel

- ADR 0026'nın "apps/api HA'ya relay üzerinden bağlanır" modelinden sapan ikinci bir yol var. Bu sapma dev-first olarak işaretli ama yanlış anlaşılma riski taşıyor — bu yüzden bu ADR yazıldı.
- Production onboarding için ayar push'u **henüz çözülmedi**; relay/add-on yolu ayrı bir epic.
- apps/api artık (dev'de) HA Core'a giden bir LLT tutuyor — Supervisor proxy'sinin placeholder token'ından farklı, gerçek bir secret. `.env`'de, asla commit edilmez.

### Etkileri

- **Kod organizasyonu:** Node WS transport `apps/api`'da; core'un ha barrel'ı Node-safe oldu (DirectWsTransport subpath'e taşındı).
- **CI/build:** Ek bağımlılık yok (Node 22 global WebSocket). Üç pakette test eklendi.
- **Göç:** Production relay yolu geldiğinde `applyHaSetup`'ın transport/client factory'si değişir; mapping + route contract aynı kalır.

## Tekrar değerlendirme tetikleyicileri

- Cloud relay backend (#345 ailesi) production'a hazır olduğunda: ayar push'u relay üzerinden yapılacak; bu doğrudan-WS yolu dev-only'ye sıkışır veya kaldırılır — yeni ADR.
- HA base image s6-overlay/WebSocket davranışı değişirse veya `@types/node` global `WebSocket`/`MessageEvent`/`CloseEvent` tiplerini eklerse: `node-ws-transport.ts`'in local tip declaration'ı sadeleşebilir.

## Referanslar

- [ADR 0016 — HaClient transport mimarisi](0016-ha-ws-transport.md)
- [ADR 0026 — apps/api delivery: hosted](0026-apps-api-delivery-hosted.md)
- [ADR 0028 — device-config state](0028-device-config-state.md)
- [docs/dev-supervisor.md](../dev-supervisor.md) — HA Core WS env + dev kurulum
- HA WebSocket API: <https://developers.home-assistant.io/docs/api/websocket>

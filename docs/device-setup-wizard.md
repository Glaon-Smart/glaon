# Cihaz Setup Wizard

Glaon'un **first-run device setup wizard**'ının teknik runbook'u — bir Glaon kurulumu ([epic #533](https://github.com/toss-cengiz/glaon/issues/533)) yeni bir cihazda ilk açıldığında kullanıcının kurması gereken ayarları toplayan akış. Bu doc "neden böyle" (rationale → [ADR 0028](adr/0028-device-config-state.md)) değil, "nasıl çalışır + sırada ne var" sorularına cevap verir.

## Wizard ne yapar?

`SetupGate` boot anında üç durumdan birine karar verir:

```
                            ┌──────────────────────────────┐
window.localStorage         │   SetupGate (apps/web/src/    │
  └─ glaon.device-config ──►│         setup/setup-gate.tsx) │
                            └────┬───────────┬──────────────┘
                                 │           │
       VITE_APP_MODE === 'ingress'│           │ completedAt yok
            (HA Add-on)          │           │
                                 ▼           ▼
                          Router'a            SetupRoute
                          devam et             (lazy chunk)
                                                 │
                                                 ▼
                                       5 step state machine
                                       ├─ home-overview
                                       ├─ layout
                                       ├─ wifi
                                       ├─ security
                                       └─ review  ──► markComplete()
                                                          │
                                                          ▼
                                              /login (mevcut Router)
```

`completedAt: ISOString` damgası `WebConfigStore`'un `peekSync()` ile senkron okuduğu boolean'dır — flash-of-login yaşanmaz. Refresh mid-wizard adım 1'e döner; bu kabul edilen davranıştır (bkz. [ADR 0028 — Sonuçlar](adr/0028-device-config-state.md#sonu%C3%A7lar)).

## Ship sırası

Epic 1 izleme issue + 17 sub-issue'ya bölündü. İlk sevkiyatın bağımlılık grafı:

```
#534 (ADR 0028) ─► #535 (core) ─► #536 (web)
                                      │
                                      ├─► #539 (gate) ─► #540 (step 1) ─┐
#537 (SetupLayout) ─► #538 (StepNav) ─┘                                  │
                                                                          │
#541 ─► #545 (step 2 layout)  ─────────────────────────────────────────────┤
#542 ─► #546 (step 3 wifi)   ─────────────────────────────────────────────┤
#543 ─► #547 (step 4 security)─────────────────────────────────────────────┤
#544 ─► #548 (step 5 review) (#546 collected shape'i de gerekli) ─────────┤
                                                                          ▼
                                                                  #549 (E2E smoke)
```

Yapı bittiğinde mobil parity (`apps/mobile` SetupGate + `ExpoConfigStore`) ayrı bir issue olarak takip edilir; iki platform aynı `ConfigStore` interface'i üzerinden konuşur ([ADR 0028](adr/0028-device-config-state.md#karar)).

## Adımlar

Her adım bir form veya konfirmasyon ekranı. Component'ler `apps/web/src/features/setup/<id>/` altında yaşar; tümü `SetupLayout` (sidebar + step rail + content) içinde render edilir.

| #   | Step id           | Issue                                                   | Toplanan veri                                             | Yan etki                                                                              |
| --- | ----------------- | ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `home-overview`   | [#540](https://github.com/toss-cengiz/glaon/issues/540) | Ev adı, konum stub, ülke, timezone, locale, birim sistemi | locale seçimi `glaon.locale` anahtarına yazılır (i18next detector aynı anahtarı okur) |
| 2   | `layout`          | [#545](https://github.com/toss-cengiz/glaon/issues/545) | v1: tek serbest metin alan (placeholder)                  | yok — gerçek floor/room editörü ayrı epic                                             |
| 3   | `wifi`            | [#546](https://github.com/toss-cengiz/glaon/issues/546) | Seçilen SSID + parola (bellek)                            | HA Supervisor `/api/hassio/network/info` çağrısı (yalnız Ingress / kiosk modunda)     |
| 4   | `security`        | [#547](https://github.com/toss-cengiz/glaon/issues/547) | PIN (SHA-256 hex)                                         | hash bellekte hesaplanır; plaintext PIN cihazdan asla çıkmaz                          |
| 5   | `review` + commit | [#548](https://github.com/toss-cengiz/glaon/issues/548) | önceki adımların özeti                                    | Wi-Fi → HA push, `ConfigStore.setPartial` + `markComplete`, `/login`'e yönlendirme    |

Adımlar arası `collected: DeviceConfigInput` route-local belleğinde birikir — ConfigStore'a yalnız adım 5 yazar. Bu sayede yarım kalan wizard'lar localStorage'a tutarsız blob bırakmaz, ve plaintext Wi-Fi parolası diskten tamamen uzak durur.

## Saklama şekli ve şema

ADR 0028 zaten dondurdu; tek paragraflık özet:

- **Interface**: `ConfigStore` `@glaon/core/config` içinde (`get`, `setPartial`, `markComplete`, `isConfigured`, `clear`).
- **Web adapter**: `WebConfigStore` (`apps/web/src/config/web-config-store.ts`) → `window.localStorage` üzerinde `glaon.device-config` anahtarı. JSON + zod safeParse.
- **Configured sinyali**: `completedAt: ISOString` alanının varlığı. Doluluk değil — opsiyonel alanlar wizard'ı yeniden tetiklemez.
- **Mobil parity**: aynı interface, `expo-secure-store` arkalı `ExpoConfigStore`. Ayrı issue.

Schema şu an versiyon 1 (`schemaVersion: 1`); strict-mode parse bilinmeyen alanları reddeder. Migration gerekliliği oluştuğunda yeni bir ADR + bumped version açılır.

## Ingress modu — wizard atlanır

`import.meta.env.VITE_APP_MODE === 'ingress'` olduğunda `SetupGate` wizard'ı atlar ve doğrudan Router'a düşer. Sebep: HA Add-on olarak teslim edildiğimizde HA zaten yapılandırılmış — ev adı, timezone, locale çoğu zaman HA'da mevcut. Wizard'ın bu modda tekrarlı soru sorması ürün açısından zayıf. **Ingress-tuned varyant** (HA'dan ön-doldurup yalnız eksikleri sormak) ayrı bir follow-up issue olarak takip edilir.

## Wi-Fi adımının HA Supervisor bağımlılığı

Browser'lar mevcut Wi-Fi ağlarını listeleyemez; bu yüzden adım 3 (`wifi`) **HA Supervisor `/api/hassio/network/info` endpoint'ini** çağırır. Bu endpoint sadece Glaon HA Add-on (Ingress / kiosk) modlarında erişilebilir. `VITE_APP_MODE === 'standalone'` durumunda step bilgilendirici bir placeholder gösterip Next'i etkinleştirir — kullanıcı zaten standalone web kullanıyorsa Wi-Fi ayarını başka bir yerden yapmıştır.

Seçilen SSID + parola wizard route'unun belleğinde tutulur (`useState` üzerinden); ConfigStore'a yazılmaz. Adım 5 commit'te HA Supervisor'a (`POST /api/hassio/network/<interface>/update`) push edilir. Bu sayede yarım kalan wizard'lardan localStorage'a plaintext parola sızmaz.

## Factory reset (kapsam dışı, sözleşmesi hazır)

ADR 0028 factory-reset'in **sözleşmesini** donduruyor: `ConfigStore.clear()` + `TokenStore.clear()` çağrılarının kombinasyonu. UI affordance ve onay diyalogu ayrı bir follow-up issue ile gelecek. Bu doc'un amaçları için bilmen gereken tek şey: wizard'ın yazdığı blob `clear()` ile tek seferde silinebilir, başka cleanup gerektirmez.

## Mobil parity roadmap

`apps/mobile`'de gate + ExpoConfigStore adapter'ı henüz yok. Web ship olduktan sonra ayrı bir issue açılıp şu üç dosyayı ekleyecek:

1. `apps/mobile/src/config/expo-config-store.ts` — `KeyValueConfigStore` ile `expo-secure-store` adapter'ı arasında köprü.
2. `apps/mobile/src/setup/setup-gate.tsx` — web'inin mobil eşi.
3. `apps/mobile/App.tsx` — `ConfigProvider` mount + `SetupGate` Router'ı sarması.

Aynı `glaon.device-config` anahtarı kullanılır (cross-platform debug ergonomisi).

## Geliştirici manuel-test akışı

`apps/web` dev modunda:

1. `pnpm --filter @glaon/web dev` → tarayıcıda `/` aç.
2. DevTools → `localStorage.clear()` → reload → wizard görünmeli.
3. Adımları tıklayarak 5. ekrana ulaş (v1'de adım 1 Home Overview gerçek formdur; 2-5 placeholder).
4. Step 5 commit (#548 lands when ready) → `/login`'e yönlendirme.
5. Reload → login görünmeli, wizard tekrar tetiklenmemeli (`completedAt` set).
6. `VITE_APP_MODE=ingress pnpm --filter @glaon/web dev` → wizard boş localStorage'da bile atlanmalı.

E2E smoke ([#549](https://github.com/toss-cengiz/glaon/issues/549)) bu akışı Playwright ile otomatize eder; `apps/web-e2e/tests/support/test.ts` shared fixture'ı configured-by-default seed eder, wizard testi opt-out olarak clear ile başlar.

## Referanslar

- [Epic #533 — device setup wizard](https://github.com/toss-cengiz/glaon/issues/533)
- [ADR 0028 — Cihaz konfigürasyon state'i](adr/0028-device-config-state.md)
- [ADR 0004 — `@glaon/core` platform-agnostic paylaşım paketi](adr/0004-glaon-core-platform-agnostic.md)
- [ADR 0006 — Token storage](adr/0006-token-storage.md) (paterni mirror ettik)
- [ADR 0009 — HA Add-on + Ingress teslim kanalı](adr/0009-ha-addon-ingress-delivery.md)
- [Figma node `1277:791`](https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=1277-791) — wizard chrome + adım 1 frame
- [CLAUDE.md — API Error Toast Rule](../CLAUDE.md#api-error-toast-rule)
- [CLAUDE.md — Design-System Fidelity Rule](../CLAUDE.md#design-system-fidelity-rule-mandatory-no-exceptions)

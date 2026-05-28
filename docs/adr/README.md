# Mimari Karar Kayıtları (ADR)

Bu klasör Glaon'un mimarisine dair kalıcı kararları Michael Nygard formatında tutar. ADR'lar "neden" sorusunu karar anında dondurur; kod ne yapıldığını zaten söyler, ADR **neden böyle yaptığımızı** söyler.

## Ne zaman ADR yazılır?

Bir karar ADR'ye hak ediyor mu diye sorman gereken üç soru:

1. **Geri dönüş maliyetli mi?** — Değiştirmek için migrasyon, refactor veya eğitim gerekiyorsa evet.
2. **Rakip seçeneklerle ciddi tartışma oldu mu?** — Alternatifleri değerlendirip birini seçtiysen evet.
3. **Proje dışından biri "neden böyle?" sorar mı?** — Yeni ekip üyesi veya 6 ay sonraki sen soruyorsa evet.

İki veya daha fazla soruya "evet" diyorsan ADR yaz. Örnekler:

- Bir framework veya runtime seçimi (Vite vs Next, Expo vs bare RN).
- Paket sınırları ve bağımlılık yönleri (`@glaon/core` platform-agnostic olmak zorunda).
- Güvenlik modeli kararları (OAuth2 PKCE, token storage).
- Tedarik zinciri kararları (Chromatic, Sentry, Renovate).
- Teslim kanalı (HA Add-on + Ingress).

ADR yazılmayacak olanlar: kütüphane version bump'ları, rutin refactor, bug fix'ler, kod stili kararları (linter yakalar), küçük kapsamlı tooling seçimleri (ESLint eklentisi gibi).

## Süreç

### Yeni ADR açmak

1. Bu klasörde `NNNN-kisa-baslik.md` dosyası oluştur. Numara sıradaki boş numara (şu an `0020`'den başlıyor; 0020–0023 aralığı Phase 2 ADR'leri için rezerve — bkz. issue #340, #341, #342, #407).
2. [`template.md`](template.md)'i şablon olarak kullan.
3. İlk hali **Status: Proposed** olarak açılır. Tartışma açıksa bu aşamada PR review üzerinden yürütülür.
4. Karar kesinleştiğinde status'ü **Accepted**'e geçir ve karar tarihini yaz.
5. ADR, onu hayata geçiren PR ile aynı branch'te merge edilir. Aynı PR'da ilgili kod değişiklikleri + ADR beraber landing yapar ki ileride hangi kodla hangi karar eşleşiyor izlenebilir olsun.

### ADR'yi değiştirmek

ADR'ler **immutable** dokümanlardır. İçeriklerini değiştirme, yeni bir ADR yazıp bu ADR'yi superseded olarak işaretle.

- Eski ADR: Status: **Superseded by [ADR-NNNN](NNNN-...md)**
- Yeni ADR: Bağlam bölümünde eski ADR'yi referansla, neyin değiştiğini ve neden gündemin yeniden açıldığını anlat.

Deprecated durumu, kararı yapılacak işin dışına çıkarttığımızda kullanılır (ör. bir paketi tamamen kaldırdık ve onun ADR'si artık geçerli değil ama üstüne yeni karar gelmiyor).

### ADR'yi süpersede etmek

"X aracını değiştiriyoruz" gibi bir karar ADR'nin yeniden yazımını tetikler. Eski ADR dosyada kalır — tarih kaybetmemek için. Yeni dosya yeni numaradan açılır.

## Index

| #    | Başlık                                                                                         | Durum              | Tarih      |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------ | ---------- |
| 0001 | [Turborepo + pnpm workspaces](0001-turborepo-pnpm-workspaces.md)                               | Accepted           | 2026-04-20 |
| 0002 | [Vite + React 19 (web)](0002-vite-react-19-web.md)                                             | Accepted           | 2026-04-20 |
| 0003 | [Expo SDK + new architecture (mobile)](0003-expo-new-architecture-mobile.md)                   | Accepted           | 2026-04-20 |
| 0004 | [`@glaon/core` platform-agnostic paylaşım paketi](0004-glaon-core-platform-agnostic.md)        | Accepted           | 2026-04-20 |
| 0005 | [OAuth2 Authorization Code + PKCE (tek auth yöntemi)](0005-oauth2-pkce-only-auth.md)           | Superseded by 0017 | 2026-04-20 |
| 0006 | [Token storage — in-memory + httpOnly / SecureStore](0006-token-storage.md)                    | Accepted           | 2026-04-20 |
| 0007 | [Sentry observability backend olarak](0007-sentry-observability.md)                            | Accepted           | 2026-04-20 |
| 0008 | [Chromatic tek görsel regresyon aracı](0008-chromatic-visual-regression.md)                    | Accepted           | 2026-04-21 |
| 0009 | [HA Add-on + Ingress teslim kanalı](0009-ha-addon-ingress-delivery.md)                         | Accepted           | 2026-04-20 |
| 0010 | [Figma tasarım kaynağı + plugin bridge](0010-figma-source-of-truth.md)                         | Accepted           | 2026-04-22 |
| 0011 | [Untitled UI React kit + CLI source-based delivery](0011-untitled-ui-react-kit.md)             | Accepted           | 2026-04-27 |
| 0012 | [Tailwind CSS for `@glaon/ui`](0012-tailwind-css-for-glaon-ui.md)                              | Superseded by 0013 | 2026-04-27 |
| 0013 | [Tailwind v4 + Untitled UI theme.css](0013-tailwind-v4-uui-theme.md)                           | Accepted           | 2026-04-27 |
| 0014 | [`apps/api` ayrı backend service (Next.js geçişi yerine)](0014-apps-api-over-nextjs.md)        | Accepted           | 2026-05-06 |
| 0015 | [State yönetimi — Zustand + Immer + TanStack Query](0015-state-management.md)                  | Accepted           | 2026-05-07 |
| 0016 | [HA WebSocket transport mimarisi](0016-ha-ws-transport.md)                                     | Accepted           | 2026-05-07 |
| 0017 | [Dual-mode auth — local HA OAuth + cloud-relay (Clerk)](0017-dual-mode-auth.md)                | Accepted           | 2026-05-07 |
| 0018 | [Cloud relay topology + wire protocol](0018-cloud-relay-topology.md)                           | Accepted           | 2026-05-07 |
| 0019 | [Identity provider — Clerk (cloud mod için)](0019-identity-provider-clerk.md)                  | Accepted           | 2026-05-07 |
| 0020 | [Cloud hosting platform — CF Workers + Durable Objects](0020-cloud-hosting-platform.md)        | Accepted           | 2026-05-07 |
| 0021 | [Pairing protocol + relay credential lifecycle](0021-pairing-and-relay-credentials.md)         | Accepted           | 2026-05-07 |
| 0022 | [Cloud deployment + secrets pipeline](0022-cloud-deployment-secrets.md)                        | Accepted           | 2026-05-07 |
| 0023 | [i18n library + file format + RTL strategy](0023-i18n-library-format-rtl.md)                   | Accepted           | 2026-05-07 |
| 0024 | [Lokal keşif: HA hostname'ine bağ kal](0024-local-discovery-rely-on-ha-hostname.md)            | Accepted           | 2026-05-08 |
| 0025 | [apps/api stack pick — Hono + native MongoDB + Zod](0025-apps-api-stack.md)                    | Accepted           | 2026-05-09 |
| 0026 | [apps/api delivery: Glaon-managed hosted](0026-apps-api-delivery-hosted.md)                    | Accepted           | 2026-05-10 |
| 0027 | [HA `login_flow` password-grant proxy (cloud-side)](0027-ha-login-flow-proxy.md)               | Accepted           | 2026-05-10 |
| 0028 | [Cihaz konfigürasyon state'i (first-run setup wizard)](0028-device-config-state.md)            | Accepted           | 2026-05-17 |
| 0029 | [Setup wizard ayar push'u: apps/api → HA Core doğrudan WS](0029-apps-api-ha-core-direct-ws.md) | Accepted           | 2026-05-28 |

## Konvansiyonlar

- Dosya adı: `NNNN-kisa-baslik.md`, numara 4 haneli sıfır-dolgulu, slug kebab-case + Türkçe karakter yok (ASCII). İçerikte Türkçe karakter serbest.
- Dil: Türkçe (`docs/` klasörünün dil politikasıyla uyumlu — [CLAUDE.md](../../CLAUDE.md#language-policy)).
- Uzunluk: Genelde 1-3 sayfa. Karar uzun olursa bağlamı ayrı dokümana taşı ve ADR'den linkle.
- Kod örneği: Minimalde tut. ADR karar belgesidir, kullanım kılavuzu değil. Kullanım detayları ilgili `docs/*.md` veya inline README'ye gider.

## Retrospektif ADR'ler

Phase 0'daki ilk 10 karar retrospektif olarak yazıldı (bkz. #89). Bu kararlar issue açılmadan önce zaten CLAUDE.md, docs/ARCHITECTURE.md ve PR gövdelerinde alınmıştı — ADR'ler karar tarihlerini mümkün olduğunca kararın alındığı tarihi baz alır (genelde repo bootstrap'i olan 2026-04-20). Yeni kararlar bundan sonra karar alınırken yazılır, retrospektif değil.

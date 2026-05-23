# Bağımlılık yönetimi

Glaon'un npm paketlerini güncel ve güvenli tutan otomasyon katmanı. Amacı: "şu paket eski mi?" kontrolünü insan işi olmaktan çıkarmak ve güvenlik açıklıklarını geç değil, erken yakalamak.

## Aktörler

| Bileşen                                                                           | Ne yapar                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Renovate](https://docs.renovatebot.com/)                                         | Haftalık outdated taraması + otomatik güncelleme PR'ları                                         |
| `pnpm audit --audit-level high`                                                   | CI'da her PR'da çalışır; high/critical açıklık bulursa build kırar                               |
| [`syncpack`](https://jamiemason.github.io/syncpack/)                              | Cross-workspace tek-versiyon politikası; PR'da drift varsa CI kırar                              |
| [`knip`](https://knip.dev)                                                        | Kullanılmayan dosya / bağımlılık / import taraması; yeni ölü kod PR'da CI'yı kırar               |
| [`publint`](https://publint.dev/) + [`attw`](https://arethetypeswrong.github.io/) | `packages/*` için `package.json` exports + tip çözümleme sözleşmesi; bozulursa CI kırar          |
| Dependency Review action                                                          | Her PR'da `pnpm-lock.yaml` diff'ini tarar — bkz. [governance](./governance.md#dependency-review) |
| GitHub Dependabot alerts                                                          | Repo-level UI uyarıları (user tarafından açılır)                                                 |

Aktörler birbiriyle çakışmaz — Dependabot alerts sadece sinyal üretir, düzeltmeyi Renovate yapar; `syncpack` cross-workspace tutarlılığı zorlar; `knip` ölü kod + kullanılmayan bağımlılık taraması; `publint` + `attw` paket contract'ını doğrular; audit ve dependency review CI'da son kontrol.

## Renovate iş akışı

### Dependency Dashboard

Renovate, repo'da her zaman açık tek bir "Dependency Dashboard" issue'su tutar. Tüm mevcut güncellemeler (auto-merge edilenler dahil) bu issue'da listelenir. Bu issue aynı zamanda Glaon'un "Issue-First Rule"u için bağımlılık güncellemelerinin resmi tracking issue'sudur — her Renovate PR'ı dashboard'u `Refs` ile işaret eder.

Nerede: repo Issues → `Dependency Dashboard` başlıklı, `dependencies` label'lı issue.

### Schedule

- **Düzenli** (patch + minor): her Pazartesi sabahı 09:00 (Europe/Istanbul) PR dalgası
- **Güvenlik**: schedule'dan bağımsız, `vulnerabilityAlerts` tetiklenir tetiklenmez
- **Lockfile bakımı**: haftalık, transitive semver-range içi güncellemeler için

### PR gruplandırması

Tekil paket başına bir PR yerine ekosistem bazlı gruplandırma:

- `storybook` — `storybook`, `@storybook/*`, `storybook-dark-mode`
- `react 19` — `react`, `react-dom`, `@types/react*`
- `react native + expo` — `react-native`, `react-native-web`, `expo*`
- `eslint` — `eslint*`, `@typescript-eslint/*`, `typescript-eslint`, `globals`
- `typescript`, `vite`, `chromatic`, `commit hooks`, `github actions`

Gruplandırılmayan paketler kendi PR'ları ile gelir.

### Auto-merge

| Tür                         | Karar                                         |
| --------------------------- | --------------------------------------------- |
| Patch (her paket)           | Auto-merge (CI yeşil şartıyla)                |
| Minor — devDeps             | Auto-merge (CI yeşil şartıyla)                |
| Minor — prod deps           | Manuel review                                 |
| Major                       | Dashboard onayı → PR → manuel review + merge  |
| Güvenlik (severity'ye göre) | PR açılır; auto-merge kuralları aynen geçerli |

"CI yeşil" = type-check · lint · audit + Chromatic + commitlint + gitleaks tümü pass. Branch protection auto-merge'ü engelliyorsa PR açık kalır.

## Review checklist (Renovate PR'ı geldiğinde)

Tipik patch PR'ı otomatik geçer, ama manuel olarak bakacağın bir PR geldiğinde:

1. **Release notes**: Renovate PR body'sinde "Release Notes" bölümünde ilgili changelog linki var mı? Bariz breaking change geçmişi var mı?
2. **CI durumu**: Tüm check'ler yeşil mi? Chromatic snapshot'larda değişiklik var mı (görsel regresyon riski)?
3. **Lock file**: `pnpm-lock.yaml` makul boyutta değişti mi? Beklenmedik transitive eklemeler?
4. **Monorepo etkisi**: Paket hangi workspace'te? Birden fazla etkiliyorsa `@glaon/core` → `@glaon/ui` → `apps/*` yönünde tutarlı mı?
5. **Prod vs dev**: `package.json`'da hangi bucket? Prod dep ise ekstra dikkat; devDep ise rahat.

## Major version bump'ları

Major'lar auto-PR açmaz — önce dashboard'da "approval needed" olarak durur. Karar anında:

1. Dashboard'da ilgili item'ın checkbox'ını tıkla → Renovate PR'ı açar.
2. PR body'sindeki release notes'u oku. Breaking change'leri listele.
3. Kod tarafında migration gerekliyse **aynı PR'a commit ekle**. Bu hâlâ Renovate PR'ı ama insan değişikliği de eklenebilir.
4. Type-check + lint + audit + Chromatic tümü yeşil olmadan merge etme. Chromatic'te unintended görsel değişiklik varsa migration tamam değil demektir.

## Cross-workspace tutarlılık (syncpack)

[syncpack](https://jamiemason.github.io/syncpack/) aynı paketin farklı workspace'lerde farklı versiyonlara kayma riskini kesiyor. Örnek: `@glaon/core` `react@19.2.5` kullanırken `@glaon/web`'in `react@19.3.0`'e geçmesi — CI drift olarak yakalar.

### Tetikleme

- Lokal: `pnpm syncpack:lint` — sadece rapor.
- Lokal fix: `pnpm syncpack:fix` — `fix-mismatches` (tüm workspace'leri aynı versiyona hizalar) + `set-semver-ranges` (range operatörünü politikaya uydurur).
- CI: her PR'da `verify` job'u içinde `pnpm syncpack:lint` koşar; drift varsa job fail olur.

### Politika (`.syncpackrc.json`)

- **Varsayılan range**: `^` — minör/patch güncellemeleri auto.
- **`@glaon/*` workspace ref'leri**: range yok (`workspace:*` pnpm protokolü).
- **Tek-versiyon zorlaması**: `prod`, `dev`, `overrides` dependency type'larında. `peerDependencies` policy dışında — peer'ler bilinçli geniş olabilir (ör. `@glaon/ui`'ın `react: ">=19"` peer'i).

### Bilinçli istisnalar (`versionGroups`)

Drift her zaman hata değil. İki bilinçli carve-out var:

1. **Expo ekosistemi** (`@glaon/mobile`) — `react`, `react-native`, `expo`, `expo-*`, `typescript`, `@types/react*` Expo SDK konvansiyonunu izler (exact pin veya `~`). Expo CLI bu versiyonları kendi SDK alignment'ı için yönetir; cross-workspace tek-versiyona zorlamak, Expo upgrade akışını kırar. Mobile Expo SDK güncellediğinde bu paketler kendi cadence'inde hareket eder.
2. **Vite hattı** — `@glaon/ui` Storybook'un `react-native-web-vite` gereği Vite 8 + `@vitejs/plugin-react` v6, `@glaon/web` ise stabil Vite 6 + plugin-react v4 kullanıyor. Storybook Vite 6'ya döndüğünde veya web Vite 8'e geçince tek-versiyona geçilir.

Her istisna `.syncpackrc.json` içinde `label` yorumuyla açıklanır — "neden ignored?" sorusu config'i okuyunca cevaplanmalı.

### Yeni istisna nasıl eklenir

1. Drift'in gerekçesi var mı? (SDK constraint, upstream runtime farkı, geçici migration penceresi — hepsi geçerli.)
2. `.syncpackrc.json`'da `versionGroups` listesine yeni bir entry ekle. `label` o gerekçeyi açık yaz — gelecekteki okuyan bizden birimizin kontrol'ünü kolaylaştırır.
3. Gerekliyse `semverGroups`'a da benzer bir carve-out (range politikası farklıysa).
4. `pnpm syncpack:lint` yerel yeşil olduktan sonra PR ile commit et.

Drift'e keyfi izin vermek yok — her istisna config'te gerekçeli.

## Ölü kod taraması (knip)

[knip](https://knip.dev) yaşam süresi dolmuş kodu — refactor sonrası kalmış export, paketten çıkarılmış ama `package.json`'da unutulmuş bağımlılık, yetim dosya — lint zamanında yakalıyor. TS'in `noUnusedLocals` kontrolü dosya içi; knip cross-file + cross-package.

### Tetikleme

- Lokal: `pnpm knip` — repo genelinde tarama.
- CI: `verify` job'u içinde `pnpm knip` koşar; bulgu varsa job fail olur.

### Mevcut politika (tier 1)

Şu an CI blocking (exit 1) olan bulgu tipleri:

- Kullanılmayan dosyalar (`files`)
- Kullanılmayan bağımlılıklar (`dependencies`, `devDependencies`)
- Listelenmemiş bağımlılıklar (`unlisted`)
- Çözülemeyen import'lar (`unresolved`)
- Listelenmemiş binary'ler (`binaries`)

Kullanılmayan export'lar (`exports`, `nsExports`, `types`, `nsTypes`, `enumMembers`, `duplicates`, `classMembers`) şu an taranmıyor — bunlar tier 2+.

### Tier yükseltme kriteri

Export taraması eklemek (tier 2) için:

1. Monorepo en az bir apps/\* + bir packages/\* gerçek kullanıcı akışı ile olgunlaşmalı (sadece scaffold değil).
2. `pnpm knip --include exports,types` lokalde temiz olmalı — kalan sinyal yoksa tier yükseltilir.
3. Yükseltme ayrı bir issue + PR; scope "`knip.json`'a rules + CI include flag".

Böyle yapmamızın nedeni: Phase 0'da çok sayıda placeholder export var (ör. `@glaon/core/auth`, `@glaon/ui/Button`) — erken export taraması, henüz yazılmamış koddan dolayı sürekli false positive üretir.

### Bilinçli istisnalar

Her carve-out `knip.json`'da workspace bazlı listelenir. Gerekçeler:

- **`@glaon/ui`, `@glaon/config` workspace ref'leri** — Apps/packages bu paketleri declare ediyor ama henüz import etmiyor. Pre-wiring: feature PR'ları geldiğinde `package.json`'a dep eklemek yerine hazır. Gerçek kullanım başlayınca allowlist'ten düşer.
- **Expo ekosistemi** (`apps/mobile`) — `expo-auth-session`, `expo-crypto`, `expo-updates`, `expo-system-ui`, `babel-preset-expo`, `@babel/core` gibi paketler native-linking + `app.json` plugin mekanizması üzerinden tüketiliyor; TS import'u yok. Knip'in Expo plugin'i bunu kısmen görür, kısmen görmez — açıkça allowlist.
- **`eslint` binary** — `@glaon/config` paketi üzerinden transitive geliyor; her workspace'in `lint` script'i `eslint .` çağrıyor ama binary'nin kendisi workspace'in `package.json`'unda yok. pnpm hoisting bunu çözüyor.
- **`tools/figma-plugin/code.js`** — Figma tarafından yüklenen plugin dosyası; npm graph'ının dışında. Root `ignore`.
- **`.lighthouserc.cjs`, `.lighthouserc.mobile.cjs`** — `lhci autorun --config=<file>` tarafından okunan config'ler; TS/JS import graph'ının içinde değil. Root `ignore`.

### Yeni istisna nasıl eklenir

1. `pnpm knip` ile rapor al; false positive mi doğrula (örn. paket gerçekten kullanılıyor mu, sadece import'u henüz yazılmamış mı?).
2. `knip.json`'da ilgili workspace'in `ignoreDependencies` / `ignoreUnresolved` / `ignoreBinaries` / `ignore` alanına ekle.
3. Gerekçeyi PR body'sinde açıkla **ve** bu dökümanın "Bilinçli istisnalar" bölümündeki listeye bir satır ekle. Config'te yorum satırı yok (JSON), "neden?" sorusu bu dökümanda cevaplanmalı.

Allowlist büyümek için değil, kapanmak için var — yeni dep gerçek kullanılır hâle gelir gelmez ilgili ignore satırı düşürülür.

## Paket contract kontrolü (publint + attw)

`packages/*` paketleri (`@glaon/config`, `@glaon/core`, `@glaon/ui`) monorepo dışından tüketilmese bile bir "paket contract"ı var: `package.json` içindeki `exports`, `main`, `types`, `type: "module"` alanları tutarlı olmalı, alt-path export'lar gerçekten dosyayı göstermeli, type declaration'lar hem ESM hem CJS resolver'a çalışır gözükmeli. Bu alanlar sessizce kayarsa ilk kurban downstream consumer (web/mobile bundler) olur. `publint` + [`@arethetypeswrong/cli`](https://arethetypeswrong.github.io/) bu sözleşmeyi PR zamanında çekecek şekilde lint'ler.

### Tetikleme

- Lokal: `pnpm package-contract` — `packages/*` filter'lı turbo task'ı; her paketin kendi `publint` + `attw` çağrısını koşar.
- Lokal tekil: `pnpm --filter @glaon/core package-contract`.
- CI: `package-contract` isimli ayrı bir job; type-check/lint/audit ile eşdeğer blocking status check.

### Kapsam

- `@glaon/config`: sadece `publint` (tip dosyası yok, `exports` yalnız `./eslint` → `eslint.config.js`).
- `@glaon/core`: `publint && attw --pack .` — 5 alt-path export (`.`, `./auth`, `./ha`, `./observability`, `./types`).
- `@glaon/ui`: `publint && attw --pack .` — tek entry (`./src/index.ts`), `react >=19` peer.

### Kabul edilen `attw` kategorileri

Paketler `private: true` — npm'e publish olmuyor, sadece bundler tüketiyor. Bu yüzden `attw` üç kategoriyi `--ignore-rules` ile muaf tutuyoruz:

| Rule                        | Muafiyet gerekçesi                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cjs-resolves-to-esm`       | `exports` alanı `.ts` kaynağını gösteriyor (`./src/index.ts`); Node16 CJS resolver "bu ESM'dir" diyor — doğru, paket bundler-first. Node CJS consumer yok. |
| `internal-resolution-error` | `.ts` exports'una Node doğrudan resolve edemez; bundler `ts-loader`/Vite `esbuild` dönüştürür. Monorepo-internal kullanım için beklenen davranış.          |
| `no-resolution`             | Aynı kök sebep — Node "bu dosyayı tanımıyorum" diyor; bundler tanıyor.                                                                                     |

Bilerek açık bıraktıklarımız (gerçek hata kategorileri):

- `false-cjs` — Paket ESM iddia ediyor ama CJS module yayınlıyor (veya tersi).
- `false-esm` — ESM gibi görünen dosyalar aslında CJS.
- `entrypoint-resolution` farkları (CJS ve ESM aynı sembolü farklı çözüyor).
- `missing-types` / `types-incorrect-extension`.

Bu kategorilerden biri düşerse `attw` CI'ı kırar — ignore listesi büyümez, sebebin kendisi düzeltilir.

### Publish-readiness

Bu "bundler-first, src'den export" modeli Phase 0 konvansiyonu. Paketlerden biri gerçekten `npm publish` edilecek olursa (ki şu an plan yok):

1. `exports` built `dist/` hedeflerine çevrilir (`./dist/index.js` + `./dist/index.d.ts`).
2. `tsc -b` output'ları `dist/` altına emit edilir, `files` alanı paketten.
3. Yukarıdaki üç `--ignore-rules` düşer; `attw` temiz `🟢` grid'i bundler + Node10 + Node16 hepsinde ister.

Bu geçiş ayrı bir issue + ADR ile yönetilir — bu dökümanda takipçi olarak not edilir, şu an kapsamda değil.

### Bilinçli istisnalar (genişletme)

- `@glaon/config` paketinin `tsconfig.base.json` alt-path export'u kasten kaldırıldı. External bir path'a (`"../../tsconfig.base.json"`) işaret ediyordu; `publint` bunu iki ayrı kural ile bildirdi. Gerçek tüketici yok — workspace'ler doğrudan `extends: "../../tsconfig.base.json"` kullanıyor.
- Yeni bir external alt-path export'u eklemeye karar verirsen, exports entry'si workspace'in kendi paket köküne bağlı kalmalı — paket dışı göreceli yollar paket boundary'sini bozar ve `publint` doğru olarak kırar.

## Rollback / pin

Bir paket yeni sürüm sonrası sorun çıkarırsa:

1. Hatalı versiyonu `package.json`'da sabit semver ile pin'le (`"foo": "1.2.3"`).
2. `renovate.json`'a `packageRules` entry'si ekle:
   ```jsonc
   { "matchPackageNames": ["foo"], "allowedVersions": "<1.3.0" }
   ```
3. Ayrı issue aç, kök sebebi araştır, hazır olunca constraint'i kaldır.

Transitive bir bağımlılık high/critical advisory aldıysa ve doğrudan tüketicimiz henüz patch sürümü yayınlamadıysa, aynı yöntemi `pnpm.overrides` üzerinden kullanırız — kök `package.json`'da `pnpm.overrides` bloğuna minimum güvenli versiyonu yaz, `pnpm install` ile lockfile'ı yenile, audit'in yeşil olduğunu doğrula. Her aktif override aşağıdaki tabloda gerekçesi ve kalkış tetikleyicisi ile birlikte tutulur — pin gereksizleştiğinde (override olmadan da `pnpm audit --audit-level high` yeşil) `package.json` ve bu tablodan birlikte düşürülür.

### Aktif override'lar

Kök [`package.json`](../package.json) `pnpm.overrides` bloğunda hâlen aktif olan pin'ler:

| Paket       | Override  | Gerekçe                                                                                                                                           | Ne zaman düşer                                                                            | Tracking |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| `basic-ftp` | `>=5.3.1` | [GHSA-rpmf-866q-6p89](https://github.com/advisories/GHSA-rpmf-866q-6p89) — transitive `basic-ftp@<5.3.1`                                          | `basic-ftp` transitive consumer'ları kendiliğinden `>=5.3.1`'e geçtiğinde                 | #405     |
| `js-cookie` | `>=3.0.7` | [GHSA-qjx8-664m-686j](https://github.com/advisories/GHSA-qjx8-664m-686j) — `apps/mobile` Clerk SDK üzerinden transitive `js-cookie@3.0.5` çekiyor | Clerk SDK kendi içinde `js-cookie >=3.0.7`'ye geçtiğinde (`pnpm why js-cookie` ile teyit) | #580     |

## Sorun giderme

- **Dashboard issue yok** → Renovate GitHub App repo'ya yüklü mü? Repo → Settings → Integrations.
- **PR'lar açılmıyor** → `prConcurrentLimit` veya `prHourlyLimit` dolmuş olabilir; dashboard'un "Pending" bölümüne bak.
- **Auto-merge gerçekleşmiyor** → Branch protection "Allow auto-merge" açık mı? Required status check'lerin tümü geçti mi? Renovate PR'ı her zaman commitlint'ten geçmeli (`:semanticCommits` preset'i bunu sağlıyor).
- **CI'da audit fail**, ama Renovate PR yok → Açıklık henüz Renovate'in advisory database'ine işlememiş olabilir; manuel bump + ayrı issue.
- **Schedule dışı PR bekleniyor** → Güvenlik uyarıları bypass eder. Manuel tetik için dashboard'da item'ı checkbox'la.

## User aksiyonları (tek seferlik)

1. [Mend Renovate GitHub App](https://github.com/marketplace/renovate) → Glaon repo'suna yükle.
2. Repo → Settings → **Security & analysis** → Dependabot alerts: **Enable** (ücretsiz).
3. Repo → Settings → **General** → "Allow auto-merge": **Enable**.
4. İlk Renovate çalışmasından sonra Dependency Dashboard issue'sunu kontrol et.

## Referanslar

- Renovate config: [renovate.json](../renovate.json)
- Syncpack config: [.syncpackrc.json](../.syncpackrc.json)
- Knip config: [knip.json](../knip.json)
- Package contract script: kök [package.json](../package.json) `package-contract`, turbo task aynı isimde, per-package `publint` / `attw` çağrıları [`packages/*/package.json`](../packages)
- CI audit + syncpack + knip + package-contract: [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- İlgili issue: #57 (Renovate), #95 (syncpack), #96 (knip), #97 (publint + attw).

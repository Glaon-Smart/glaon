# Favicon ve Uygulama İkonları

Glaon'un favicon ve uygulama ikonu ailesi **tek bir kaynak SVG**'den üretilir.
Web (tarayıcı sekmesi + PWA manifest), Home Assistant Add-on (Store + Info
sekmesi) ve Expo Mobile (iOS AppIcon + Android adaptive icon + splash)
yüzeylerinin hepsi aynı kaynaktan beslenir.

## Kaynak

| Dosya                                                                   | Boyut   | Açıklama                                                            |
| ----------------------------------------------------------------------- | ------- | ------------------------------------------------------------------- |
| [`packages/assets/favicon.svg`](../packages/assets/favicon.svg)         | 200×200 | Kanonik favicon — `#326789` arka plan + "Light" sembol inlay        |
| [`packages/assets/symbol_dark.svg`](../packages/assets/symbol_dark.svg) | 113×140 | Şeffaf arka planlı sembol — adaptive icon foreground ve splash için |

Tasarım kaynağı Figma: [Design System → Favicon (14867:192194)](https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=14867-192194).

## Yeniden üretim

İkonları regenerate etmek için tek komut:

```bash
pnpm icons:generate
```

Script idempotenttir; aynı kaynak SVG'lerden her seferinde bayt-bayt aynı PNG'leri
üretir. Dosyalar repo'ya commit edilir; commit'lemeden önce çalıştırın ki
`git status` temiz kalsın.

Script `scripts/icons/generate.mjs` altındadır ve `sharp` + `png-to-ico`
devDep'lerine bağlıdır (root `package.json`).

## Yüzey eşlemesi

### Web (`apps/web/public/`)

| Dosya                          | Boyut            | Kullanım                                                       |
| ------------------------------ | ---------------- | -------------------------------------------------------------- |
| `favicon.svg`                  | vector           | Modern tarayıcılar — `<link rel="icon" type="image/svg+xml">`  |
| `favicon.ico`                  | 16+32+48 (multi) | Eski tarayıcılar + Windows pinned site                         |
| `favicon-16.png`, `-32.png`    | 16, 32           | Standalone PNG fallback'ler                                    |
| `apple-touch-icon.png`         | 180              | iOS Safari "Add to Home Screen"                                |
| `icon-192.png`, `icon-512.png` | 192, 512         | PWA manifest — install prompt + Android home screen            |
| `icon-maskable-192/512.png`    | 192, 512         | Android adaptive crop için %10 safe-zone padding'li varyantlar |
| `manifest.webmanifest`         | —                | PWA manifest; `theme_color` ve `background_color` = `#326789`  |

`apps/web/index.html` içindeki `<link>` etiketleri + `<meta name="theme-color">`
tüm bu dosyaları işaret eder.

### Home Assistant Add-on (`addon/`)

| Dosya      | Boyut   | Kullanım                                          |
| ---------- | ------- | ------------------------------------------------- |
| `icon.png` | 256×256 | HA Add-on Store thumbnail ve Info sekmesi başlığı |

> **`panel_icon` notu**: `addon/config.yaml` içindeki
> `panel_icon: mdi:home-lightbulb` HA **sidebar** girdisini kontrol eder ve
> Material Design Icons referansı bekler (HA konvansiyonu). Add-on Store
> görseli olan `addon/icon.png` ile aynı şey değildir. İkisini birbirine
> bağlamayın; her ikisi de korunur.

### Mobile / Expo (`apps/mobile/assets/`)

| Dosya               | Boyut     | Kullanım                                                          |
| ------------------- | --------- | ----------------------------------------------------------------- |
| `icon.png`          | 1024×1024 | iOS AppIcon — opak, full-bleed `#326789` arka plan + sembol       |
| `adaptive-icon.png` | 1024×1024 | Android adaptive **foreground** — şeffaf arka plan, sadece sembol |
| `splash-icon.png`   | 1024×1024 | Expo splash screen — şeffaf, splash background ile compose edilir |

`apps/mobile/app.json` içinde:

- `android.adaptiveIcon.backgroundColor: "#326789"` — adaptive foreground'un
  altına gelen renk
- `icon: "./assets/icon.png"` — iOS ve generic platformlar için tam ikon

## Renk notu

Favicon arka planı `#326789` (Glaon / Dark Slate Blue) **marka sembolü**
rengidir. UUI tema sisteminde kullanılan `--color-brand-500` (`#9E77ED`,
mor) ise UI accent rengidir. Bunlar **bilerek farklıdır**:

- Marka sembolü tutarlı kalır (logo / favicon / app icon).
- UI accent tema desteği aldığında ayrı evrim geçirir.

Yeni bir UI bileşeni yazarken renk seçimini `--color-brand-*` token'ından
yapın — favicon'un `#326789` rengini hard-code etmeyin. Tersine, favicon
SVG/PNG çıktılarında UI tema token'ı kullanmayın.

## Storybook / Chromatic notu

Favicon bir React bileşeni değildir; Storybook story'si veya Chromatic
visual regression entry'si **yoktur**. Tasarım fidelity'si Figma frame
ile `apps/web/public/favicon-32.png` arasında manuel side-by-side
karşılaştırma ile doğrulanır (Design-System Fidelity Rule, CLAUDE.md).
İhtiyaç doğarsa `packages/ui` altına bir MDX docs sayfası eklenebilir.

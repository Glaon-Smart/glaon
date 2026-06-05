# Claude Orkestrasyon Rehberi

Bu doküman, Glaon'da Claude Code oturumlarının nasıl orkestre edildiğini anlatır: slash command'lar, subagent'lar ve worktree tabanlı paralel çalışma deseni. Amaç, CLAUDE.md'deki zorunlu kuralların her oturumda — insan yönetiminde ya da paralel ajan akışında — aynı disiplinle uygulanmasıdır.

## Yapı taşları

| Katman            | Konum                | Görev                                                            |
| ----------------- | -------------------- | ---------------------------------------------------------------- |
| Slash command'lar | `.claude/commands/`  | Workflow ritüellerini tek komuta indirger                        |
| Subagent'lar      | `.claude/agents/`    | Alan-uzmanı ajan tanımları (UI, tasarım doğrulama, güvenlik, CI) |
| Skill'ler         | `.claude/skills/`    | Alan bilgisi paketleri (ör. `brand-design`)                      |
| Hook'lar          | `.claude/hooks/`     | Oturum açılışında ortam hazırlığı (`session-start.sh`)           |
| Worktree'ler      | `.claude/worktrees/` | Paralel ajanların izole çalışma kopyaları                        |

## Slash command'lar

- **`/start-issue <numara | açıklama>`** — Issue-First kuralını işletir: issue bul/aç, numarayı bildir, `development`'tan branch aç (kirli çalışma ağacında worktree'ye düşer), kapsamı özetle, hangi zorunlu kuralların tetiklendiğini söyle.
- **`/ship [numara]`** — PR sözleşmesini uygular: pre-flight (type-check, lint, story/smoke/security kontrolleri), `--base development` ile PR, gövdede Summary / Scope In-Out / Figma node / Test plan / `Closes #N`, ardından CI yeşilene kadar izleme. Merge etmez — merge kullanıcıya aittir.
- **`/sync-pr [numara]`** — Push öncesi "PR gövdesi hâlâ bu diff'i anlatıyor mu?" kontrolü. Scope ve test planı diff ile eşitler, tracking issue'yu senkronlar.

## Subagent'lar

- **`ui-builder`** — UUI Source Rule, Storybook Rule, token-only stil ve data-fetching sınırını bilen bileşen üreticisi. Figma node ID'siz bileşen üretmez.
- **`design-verifier`** — Design-System Fidelity kuralının bekçisi. Figma frame ↔ implementasyon karşılaştırması yapar; her sapma merge engelidir, "sonra düzeltiriz" çıktısı üretmez.
- **`security-reviewer`** — auth/storage/network/crypto dokunuşlarında devreye girer; token saklama, CSP, PKCE, paket sınırları gibi Glaon invariant'larını denetler.
- **`ci-shepherd`** — push sonrası `gh pr checks --watch` döngüsünü sahiplenir; commitlint, Chromatic, Playwright, audit hatalarını kök nedene kadar triage eder. Check'i zayıflatarak yeşile çevirmek yasak.

## Worktree tabanlı paralel çalışma deseni

Tek bir "orkestratör" oturum işleri dağıtır; her iş kendi worktree'sinde, kendi branch'inde, kendi ajanında ilerler. Ana checkout'taki devam eden çalışmaya asla dokunulmaz (başkasının WIP'i stash'lenmez).

### Akış

1. **Orkestratör** issue'ları seçer ve her biri için `/start-issue <N>` mantığını işletir:
   ```bash
   git fetch origin development
   git worktree add .claude/worktrees/<issue>-<slug> -b <issue>-<slug> origin/development
   ```
2. **Worker oturumu/ajanı** ilgili worktree'de açılır; yalnızca kendi branch'ine commit eder. Commit mesajları Conventional Commits + `Refs #N`.
3. İş bitince worker `/ship` akışını koşar; PR `development`'ı hedefler, `Closes #N` içerir.
4. **Orkestratör** PR linklerini toplar, CI durumlarını `ci-shepherd` ile izletir, kullanıcıya tek özet sunar. Merge kararı ve butonu kullanıcıdadır.
5. Merge sonrası branch otomatik silinir (`delete_branch_on_merge`); worktree temizlenir:
   ```bash
   git worktree remove .claude/worktrees/<issue>-<slug>
   ```

### Kurallar

- Worktree başına tek issue, tek branch. Aynı isimle branch yeniden açılmaz; yeni iş = yeni issue + yeni branch.
- Worktree'ler `.claude/worktrees/` altında yaşar ve commit edilmez.
- İki ajanın aynı dosya alanına dokunacağı işler paralel dağıtılmaz; orkestratör çakışmayı issue seçiminde önler.
- Her worker, ana repo kurallarının tamamına tabidir — paralellik hiçbir zorunlu kuralı gevşetmez.

## İlgili dokümanlar

- Kurallar: [CLAUDE.md](../CLAUDE.md)
- Test stratejisi: [docs/testing.md](testing.md)
- Chromatic akışı: [docs/chromatic.md](chromatic.md)
- Figma süreci: [docs/figma.md](figma.md)

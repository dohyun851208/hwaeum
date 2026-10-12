# Hwaeum Design System

## 1. Atmosphere & Identity

Hwaeum is one world under one night, all carrying the `畵 + 音` seal:

- **Landing (`index.html`)** — night ink paper. A melody line is drawn over a hidden ink landscape; each note brings the ink up and the finished song colours the whole painting. Only the brand word `화음`, the seal and one button are visible; two quiet icons sit in the bottom-right corner (sound, and `→` straight into the studio for returning visitors).
- **Studio (`studio.html`)** — a lit hanji sheet on the night wall. The wall is the landing's ink; the header (brand, seal, step line) sits on it in cream and gold, like the gallery header. Each step is one bright hanji sheet with a thin gold edge, because the studio is where students read and write, and dense text needs light. (A daytime room until 2026-10-04 floated between the landing and the gallery; a fully dark studio, tried the same day, was hard to read.)
- **Gallery (`channel.html`)** — a lobby in the landing's night, then a real exhibition room. The lobby (entry, locked, no works) is the ink wall with the landing painting dim at the bottom and greets the visitor in the centre, like the landing. Once a gallery opens the visitor steps into the room: a photographed exhibition hall, works as square covers with a thin gold line on wooden shelves, and a coverflow stage under ceiling spotlights.

Works are the protagonists. Decoration stays quiet, text stays short.

## 2. Color

### Palette

The studio has two token layers with the same names. `body:not(.channel-body)` holds the **wall** (night) values for the page, header and footer; `body:not(.channel-body) :is(.screen, .publish-modal)` redefines the **sheet** (hanji) values, so every work-surface rule keeps reading `--ink`, `--canvas` … as before.

| Role | Landing | Studio token | Studio wall | Studio sheet | Gallery token | Gallery | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Page / sheet | `#101d20` | `--paper` / `--paper-2` | `#101d20` / `#0a1416` + faint grain, gold glow at the top | sheet `#fdfaf3` → `#f5efe2` (lamp light from above) | `--g-ink` / `--g-ink-deep` | `#101d20` / `#0a1416` + faint grain (lobby); exhibition-hall photo when open | Page background, step sheet |
| Panel | — | `--canvas` | `#14272b` (step circles) | `#fffdf9` (cards, buttons) | `--g-panel` | `#14272b` | Viewer, menu, dialogs, cards |
| Soft surface | — | `--soft` | `#1a2f33` | `#f7f3ea` | `--g-hover` | `rgba(243,238,224,.07)` | Memo strips, hover |
| Text strong | `#f4ead2` | `--ink` | `#f3eee0` | `#1f2522` | `--g-cream` | `#f3eee0` | Titles, values |
| Text | — | `--ink-2` | `#dcd8cc` | `#3c433e` | `--g-text` | `rgba(243,238,224,.88)` | Labels, body |
| Text muted | — | `--muted` | `#a5a9a1` | `#61655e` | `--g-muted` | `rgba(243,238,224,.62)` | Help text, captions |
| Text faint | — | `--faint` | `#7c8580` | `#9a9c94` | `--g-faint` | `rgba(243,238,224,.42)` | Placeholders only |
| Border | — | `--line` / `--line-strong` | `rgba(243,238,224,.1)` / `.2` | `rgba(40,44,36,.1)` / `.2` | `--g-line` / `--g-line-strong` | `rgba(243,238,224,.1)` / `.2` | Hairlines, outlines |
| Gold | `#e2c58d` | `--gold` | `#e2c58d` | `#84652c` (4.5:1 or more on hanji) | `--g-gold` | `#e2c58d` | Eyebrows, group names, words (#tags), past steps, drop and focus marks |
| Accent | — | `--accent` | — | runtime mood colour | — | — | Focus rings, selection, sound activity |
| Seal | `#b8432f` | `--seal` | `#b8432f` | `#b8432f` | — | `#b8432f` | The `畵音` seal only |
| Danger | — | — | — | `#b23c2f` | `--g-danger` | `#eba899` | Invalid field, delete |

### Rules

- Primary actions are **ink-filled on the studio sheet** and **cream-filled on the night** (the gallery, and the studio's current step). There are no yellow fills.
- Gold marks small things (eyebrows, group names such as `분위기`·`관악기`, words, drop and focus marks); it is never a large fill. On the hanji sheet it is the deep gold so it stays readable.
- Teal (`--accent`) is for focus, selection and sound. `js/manifest.js` mood colours may replace it at runtime; instrument colours (`--instrument-color`) mark instrument cards and their line colour. Readable text does not take the mood colour (a grey mood fell to 2.9:1).
- Seal red belongs to the `畵音` seal (`assets/brand/hwaeum-seal.svg`). It is not a theme colour.
- Studio tokens live on `body:not(.channel-body)`, gallery tokens on `.channel-body`, so neither page leaks into the other.

## 3. Typography

### Font Stack

- **Hwaeum Sans** — Pretendard v1.3.9 dynamic subset, weights 400/500/600/700 only (`assets/fonts/hwaeum-sans.css`, OFL). Used for everything except the brand word. Because only four weights are declared, older rules asking for 800–950 resolve to 700.
- **Hwaeum Hand** — Yeon Sung subset (`assets/fonts/landing-title.ttf`, only `화`·`음`). Used only for the brand word `화음`.
- Fallback: `Apple SD Gothic Neo`, `Malgun Gothic`, `system-ui`, `sans-serif`.

### Scale

| Level | Size | Weight | Usage |
| --- | --- | --- | --- |
| Brand | 30px (studio) | Hand 400 | `화음` beside the seal |
| Title | 28px (studio) · 24px (gallery header, viewer) · 36px (gallery entry) | 700 | Step titles, gallery name, work title |
| Section | 16–18px | 700 | `악기`, `효과음`, card group heads, dialog titles |
| Body | 15–16px | 400–500 | Sentences, field text, cover caption title (15/600) |
| Label | 14px | 600 | Field labels, card copy, buttons are 14–15/600 |
| Help | 13–14px | 400 | Helper lines under fields |
| Eyebrow / numbers | 12–13px | 600 | `1단계`, step numbers, time ticks, badges |

### Rules

- **14px floor** for anything a student reads. Only eyebrows, numbers and badges go to 12–13px.
- Korean wraps at spaces only: `word-break: keep-all` globally, `overflow-wrap: break-word` for overlong words, `text-wrap: balance` on headings and `pretty` on paragraphs.
- Copy is Korean and plain enough for younger students. Do not repeat the screen title in a sub-heading; hide repeats visually and keep them for screen readers.

## 4. Spacing & Layout

### Base Unit

All spacing follows a 4px base: 8 (compact), 12 (control), 16 (group), 24–32 (section), 40–48 (sheet padding, gallery grid rows).

### Grid

- Desktop-first classroom tool. No mobile layouts unless requested.
- Studio: header row `brand | step line | picture chip`, then one sheet per step.
- Gallery wall: wooden shelves of seven square covers (`WORKS_PER_SHELF`), slightly staggered heights. Every cover is square on purpose: the coverflow only reads as one continuous row when all covers share a shape (the viewer shows the whole picture).

### Rules

- **No panel inside a panel.** A step is one sheet; inside it, separate with space and hairlines, not boxes.
- When two sibling elements must read as one card (a card button and its memo field), the border, radius, background and selected state belong to their shared wrapper only.
- Studio palette tiles (instruments, effect stamps) are 88px squares starting on one left edge, grouped under a small caption (`서양`, `국악`).

## 5. Components

### Button

- **Studio**: `.btn` outline (1px `--line-strong`, 10px radius, 44px), `.btn.primary` ink fill with cream text. The save button is secondary to the share button.
- **Gallery**: `.channel-action-button` outline on ink, `.primary` cream fill with ink text, delete is a soft-red text link.
- Icon-only controls keep `aria-label`; toggles keep `aria-pressed`.

### Field

- One style for every input and textarea: 44px tall (textarea 88px), 10px radius, white (studio) or `rgba(243,238,224,.05)` (gallery) fill, 15px text, faint placeholder, accent (studio) or gold (gallery) focus.
- Wrapped fields (`#` number, word chips) draw the box on the wrapper; the inner input is transparent.

### Step Line (studio)

- `①—②—③—④—⑤` on the ink wall: past steps gold ring and gold connector, current step cream-filled (ink number) with a bold cream label, next steps grey outline. Every label keeps 4.5:1 or more.

### Gallery Cover & Caption

- Square cover with a thin gold line (1px `rgba(255,224,138,.22)`) and a soft shadow, standing on a wooden shelf. No thick mat — it made the wall read as a digital album.
- Caption band over the bottom of the cover: `제목 (작곡가)` on one line (15/600 cream) and the words below (14/600 muted). Title and composer are separate elements and CSS adds the brackets; the combined name stays in `aria-label`.
- Coverflow shows the same square covers on the exhibition stage; the centre cover gets a brighter gold line and glow, side covers hide their caption.

### Gallery Entry

- `body[data-gallery-state]` is `entry`, `loading`, `locked`, `open` or `empty` (set in `updateHeader()`).
- `entry` and `locked` move the title block and the number/code form to the centre of the screen and show the landing painting dimly; `empty` keeps the header and centres the empty message.
- Every state but `open` is the lobby (ink wall, hanji grain); `open` falls back to the exhibition-hall photo and its wall lines.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | 140ms | ease | Hover, focus, field borders |
| Standard | 160–220ms | ease | Card lift (4px), tab and tile states |
| Atmosphere | 600–700ms | ease | Mood tint, gallery landscape fade |
| Timeline | requestAnimationFrame | linear | Playhead, landing intro, coverflow drag |

- Animate only `transform`, `opacity`, `background` and colour.
- Respect `prefers-reduced-motion`: the landing starts composed, decorative pulses stop.

## 7. Depth & Surface

- Studio: each sheet hangs on the ink wall with a thin gold edge (like a gallery cover) and one deep shadow; inside it, tiles and fields are flat with hairlines. The publish dialog dims the room to ink, like the gallery viewer.
- Gallery: the exhibition room carries the depth (photographed hall, wooden shelves, coverflow stage with spotlights); panels (viewer, menu, dialogs) are `--g-panel` with one large soft shadow.
- Atmospheric images (landing painting) stay behind content and appear only in the lobby.

## 8. Where it lives

- `styles.css` ends with two override layers: `@renewal-2026-10` (studio) and `@gallery-renewal-2026-10` (gallery). They override the older rules above them; tests still pin some of those older rules, so remove them only together with their tests.
- The studio layer starts with the two token sets (wall on `body`, sheet on `.screen`/`.publish-modal`). `studio.html` declares `<meta name="color-scheme" content="dark">` and the wall sets `color-scheme: dark` (dark scrollbars, no white flash); the sheet sets `color-scheme: light` so its native controls stay light. Because `color` is inherited as a value, the sheet sets `color: var(--ink)` itself.
- Decision records: `docs/decisions/2026-10-03-studio-hanji-type-fields.md`, `docs/decisions/2026-10-03-ink-gallery-renewal.md`, `docs/decisions/2026-10-03-gallery-museum-walls.md`, `docs/decisions/2026-10-04-studio-night-wall.md`.

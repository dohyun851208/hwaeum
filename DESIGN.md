# Hwaeum Design System

## 1. Atmosphere & Identity

Hwaeum is one world seen in three lights, all carrying the `畵 + 音` seal:

- **Landing (`index.html`)** — night ink paper. A melody line is drawn over a hidden ink landscape; each note brings the ink up and the finished song colours the whole painting. Only the brand word `화음`, the seal and one button are visible; two quiet icons sit in the bottom-right corner (sound, and `→` straight into the studio for returning visitors).
- **Studio (`studio.html`)** — the daytime workroom: warm hanji paper, ink text, one sheet of paper per step. The header (brand, seal, step line) sits on the same paper as the work, never in a dark band.
- **Gallery (`channel.html`)** — the landing's night again, as an exhibition room: ink walls, works hung in cream-matted frames with a placard (title, composer, words) beneath, soft light from above. Empty rooms (entry, locked, no works) show the landing painting dimly at the bottom and greet the visitor in the centre, like the landing.

Works are the protagonists. Decoration stays quiet, text stays short.

## 2. Color

### Palette

| Role | Landing | Studio token | Studio | Gallery token | Gallery | Usage |
| --- | --- | --- | --- | --- | --- | --- |
| Page | `#101d20` | `--paper` / `--paper-2` | `#f4f0e6` / `#ede7d9` + hanji grain | `--g-ink` / `--g-ink-deep` | `#101d20` / `#0a1416` + faint grain | Page background |
| Sheet / panel | — | `--canvas` | `#fffdf9` | `--g-panel` | `#14272b` | Step sheet, viewer, menu, dialogs |
| Soft surface | — | `--soft` | `#f7f3ea` | `--g-hover` | `rgba(243,238,224,.07)` | Memo strips, hover |
| Text strong | `#f4ead2` | `--ink` | `#1f2522` | `--g-cream` | `#f3eee0` | Titles, values |
| Text | — | `--ink-2` | `#3c433e` | `--g-text` | `rgba(243,238,224,.88)` | Labels, body |
| Text muted | — | `--muted` | `#6b6f68` | `--g-muted` | `rgba(243,238,224,.62)` | Help text, captions |
| Text faint | — | `--faint` | `#9a9c94` | `--g-faint` | `rgba(243,238,224,.42)` | Placeholders only |
| Border | — | `--line` / `--line-strong` | `rgba(40,44,36,.1)` / `.2` | `--g-line` / `--g-line-strong` | `rgba(243,238,224,.1)` / `.2` | Hairlines, outlines |
| Gold | `#e2c58d` | `--gold` | `#9a7535` | `--g-gold` | `#e2c58d` | Eyebrows, words (#tags), drop and focus marks |
| Accent | — | `--accent` | `#158f8b` (runtime mood) | — | — | Focus rings, selection, sound activity |
| Seal | `#b8432f` | `--seal` | `#b8432f` | — | `#b8432f` | The `畵音` seal only |
| Frame mat | — | — | — | `--g-mat` | `#efe9dc` | Gallery frames |
| Danger | — | — | `#c4483a` | `--g-danger` | `#eba899` | Invalid field, delete |

### Rules

- Primary actions are **ink-filled** in the studio and **cream-filled** in the gallery. There are no yellow fills.
- Gold marks small things (eyebrows, words, drop and focus marks); it is never a large fill.
- Teal (`--accent`) is for focus, selection and sound. `js/manifest.js` mood colours may replace it at runtime; instrument colours (`--instrument-color`) mark instrument cards and their line colour.
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
| Body | 15–16px | 400–500 | Sentences, field text, placard title (16/600) |
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
- Gallery wall: `repeat(auto-fill, minmax(200px, 1fr))`, 52px row and 32px column gaps; every frame is square and aligned on one line.

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

- `①—②—③—④—⑤` on the paper: past steps teal, current step ink-filled with bold text, next steps grey outline.

### Gallery Frame & Placard

- Cover image with a 10px `--g-mat` mat, 3px radius, deep shadow, soft light above (masked so it has no edges).
- Placard below: title 16/600 cream, composer 14 muted, words 14 gold. Title and composer are separate elements; the combined name stays in `aria-label`.
- Coverflow uses the same frame; only the centre card shows its caption.

### Gallery Entry

- `body[data-gallery-state]` is `entry`, `loading`, `locked`, `open` or `empty` (set in `updateHeader()`).
- `entry` and `locked` move the title block and the number/code form to the centre of the screen and show the landing painting dimly; `empty` keeps the header and centres the empty message.

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

- Studio: a single soft shadow under each sheet; tiles and fields are flat with hairlines.
- Gallery: frames carry the depth (mat + shadow + light); panels (viewer, menu, dialogs) are `--g-panel` with one large soft shadow.
- Atmospheric images (landing painting) stay behind content and appear only where the room is empty.

## 8. Where it lives

- `styles.css` ends with two override layers: `@renewal-2026-10` (studio) and `@gallery-renewal-2026-10` (gallery). They override the older rules above them; tests still pin some of those older rules, so remove them only together with their tests.
- Decision records: `docs/decisions/2026-10-03-studio-hanji-type-fields.md`, `docs/decisions/2026-10-03-ink-gallery-renewal.md`.

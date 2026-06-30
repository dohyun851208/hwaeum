# Hwaeum Design System

## 1. Atmosphere & Identity

Hwaeum feels like a warm classroom gallery connected to the landing page: cream paper surfaces, quiet ink controls, gold selection moments, teal sound/focus accents, and subtle brush/music atmosphere behind the work area. The app should stay readable as a classroom tool while carrying the landing page's `畵 + 音` identity into the studio.

The Hwaeum Gallery is the more premium viewing space: darker exhibition walls, gold rails and selection light, cream placards, and teal used only as a restrained sound/focus accent. Covers should feel framed and lit, not buried in decoration.

## 2. Color

### Palette

| Role | Token | Studio | Dark | Usage |
| --- | --- | --- | --- | --- |
| Surface/page | `--paper` | `#fff7e4` | Not supported | App background start |
| Surface/page alt | `--paper-2` | `#e8eee1` | Not supported | App background end |
| Surface/canvas | `--canvas` | `#fffaf0` | Not supported | Panels, buttons, drawing canvas shell |
| Text/primary | `--ink` | `#191b17` | Not supported | Headings, controls, strong labels |
| Text/secondary | `--muted` | `#60695f` | Not supported | Help text, captions, inactive steps |
| Border/default | `--line` | `rgba(73, 62, 35, 0.15)` | Not supported | Soft panel and control outlines |
| Border/strong | `--line-strong` | `rgba(150, 113, 32, 0.34)` | Not supported | Emphasized outlines |
| Accent/primary | `--accent` | `#158f8b` | Not supported | Sound/focus accent, mood tint fallback |
| Accent/soft | `--accent-soft` | `rgba(21, 143, 139, 0.12)` | Not supported | Mood tint, selected background |
| Accent/line | `--accent-line` | `rgba(21, 143, 139, 0.42)` | Not supported | Guide lines, focus and active outlines |
| Brand/gold | `--brand-gold` | `#ffe08a` | Not supported | Primary actions and current step badges |
| Brand/red | `--brand-red` | `#de6547` | Not supported | Playhead and rare emphasis |

### Rules

- Mood colors from `js/manifest.js` may replace the accent tokens at runtime.
- New UI for drawing controls must use existing tokens. Do not introduce standalone hex colors.
- Gold is for selection, current-step emphasis, and primary forward actions. Teal is for focus, preview, and sound-related activity.
- Red is reserved for playhead/emphasis and danger states. It should not become a broad theme color.
- White text is allowed only on `--ink`, `--accent`, or danger-filled controls.
- Gallery pages may use dark exhibition surfaces, but captions, forms, and modal text must keep strong contrast through cream panels or cream text.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| Brand | `clamp(1.95rem, 2.65vw, 2.85rem)` | 400 | 1.0 | 0 | App name |
| H2 | `clamp(1.55rem, 2vw, 2.1rem)` | 800 | 1.2 | 0 | Step and panel titles |
| H3 | `1.1rem` to `1.3rem` | 800 | 1.3 | 0 | Section and card headings |
| Body | `17px` | 400 | 1.5 | 0 | Default UI text |
| Body/sm | `0.9rem` | 700 | 1.4 | 0 | Buttons, pills, supporting labels |
| Caption | `0.72rem` to `0.78rem` | 700-800 | 1.3 | 0.04em to 0.16em | Readouts, guide labels, eyebrows |

### Font Stack

- Primary: `Apple SD Gothic Neo`, `Malgun Gothic`, `Segoe UI`, `system-ui`, `sans-serif`
- Display: `Jua`, `Apple SD Gothic Neo`, `Malgun Gothic`, `system-ui`, `sans-serif`

### Rules

- User-facing copy is Korean and should be plain enough for students.
- Keep dense tool labels short. Buttons should not wrap on desktop.
- Display type is reserved for brand and title moments, not dense controls.

## 4. Spacing & Layout

### Base Unit

All spacing follows a 4px base.

| Token | Value | Usage |
| --- | --- | --- |
| Compact | `8px` | Small gaps, inline labels |
| Default | `12px` | Control padding, tight groups |
| Standard | `16px` | Toolbar gaps, step spacing |
| Panel | `20px` to `24px` | Panel padding |
| Section | `32px` to `44px` | Screen and footer spacing |

### Grid

- Desktop-first classroom tool. Mobile-specific layouts are not added unless requested.
- Main canvas is a wide horizontal timeline inside `.canvas-wrap`.
- Repeated controls use grid or flex with stable button sizes to avoid shifting while drawing.

### Rules

- New controls in the drawing panel belong in `.panel-tools`, `.bg-player`, or `.compose-control-strip`.
- Drawing canvas overlays must use absolute positioning and `pointer-events: none` unless they are interactive.

## 5. Components

### Button

- **Structure**: native `button` with `.btn`, `.round-btn`, or feature-specific button class.
- **Variants**: default, primary, small, ghost, active.
- **Spacing**: 8px to 16px internal rhythm.
- **States**: hover raises or tints, active uses `--ink` or `--accent`, disabled lowers opacity.
- **Accessibility**: keep `aria-label` for icon-only controls and `aria-pressed` for toggles.
- **Motion**: 140ms to 160ms transform or background transitions only.

### Canvas Timeline

- **Structure**: `.canvas-wrap` contains `canvas`, effect layer, pitch labels, palette labels, and playhead.
- **Variants**: normal drawing, erasing, playback, flow recording.
- **Spacing**: overlay insets match the canvas guide area.
- **States**: flow mode keeps the now-line visually fixed while scroll position changes.
- **Accessibility**: canvas has a descriptive `aria-label`; external buttons expose mode state.
- **Motion**: timeline movement uses scroll position and requestAnimationFrame, not layout animation.

### Background Player

- **Structure**: play button, label, range input, time label, optional flow toggle.
- **Variants**: available, disabled, playing, flow active, start/end range selection.
- **Spacing**: compact horizontal row with non-wrapping labels.
- **States**: active controls use accent fill or strong accent outline.
- **Accessibility**: range has an `aria-label`; toggles use `aria-pressed`.
- **Motion**: no decorative animation.

### Reflection Field

- **Structure**: labeled textarea or input below the completion placard.
- **Variants**: background reason, melody intent, hashtags.
- **Spacing**: 6px internal label gap and 12px between fields.
- **States**: focus uses the current `--accent`; default outline uses `--line-strong`.
- **Accessibility**: label is bound with `for`; helper text is connected with `aria-describedby` when present.
- **Motion**: only border/background color transition.

## 6. Motion & Interaction

### Timing

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | 140ms | ease | Button hover and active feedback |
| Standard | 160ms | ease | Card, tab, and control state changes |
| Mood | 600ms | ease | Background mood tint |
| Timeline | requestAnimationFrame | linear | Playhead, background preview, flow recording |

### Rules

- Animate only `transform`, `opacity`, `background`, or color tokens.
- Time-based drawing must preserve stable normalized x coordinates.
- Flow recording stops cleanly when the pointer is released, the timeline reaches the end, or the user leaves the drawing step.

## 7. Depth & Surface

### Strategy

Mixed: warm cream work surfaces, soft gold borders, restrained shadows, and a subtle landing-page image atmosphere behind the studio. The drawing canvas remains bright and uncluttered.

| Level | Token | Usage |
| --- | --- | --- |
| Subtle | `--shadow-sm` | Topbar, small raised controls |
| Default | `--shadow` | Panels and framed gallery elements |
| Border | `--line`, `--line-strong` | Canvas, buttons, cards |

### Rules

- Do not nest visual cards inside other card-like panels unless the inner item is a repeated object.
- Use tonal tint for selected states before adding new shadows.
- Playhead and flow guides should sit above canvas content without covering controls.
- Atmospheric images must stay behind the work surface and never compete with text or the drawing canvas.

# PlayForge

**Enterprise-grade playground equipment sales & configuration system** — built with Angular v22 (zoneless), Tauri v2, and a fully client-side architecture.

![PlayForge](src-tauri/icons/icon.png)

## Features

### 🛒 Part-Based Product Configurator
- Compose playground products from individual parts (slides, towers, safety mats, etc.)
- Live price calculation as parts are toggled
- **Reverse-match algorithm** — suggests a matching catalog variant based on the current parts selection ("Did you mean to configure [Product X]?")
- Required vs optional parts with quantity steppers

### 📦 Product Variants
- Family + Variant inheritance model — variants share a parent family and only override differing attributes (size, price, parts)
- Type-safe `VariantOverride` discriminated union prevents silent typos
- Full CRUD via Catalog Management page

### 📄 Invoice & PDF Generation
- Client-side PDF via jsPDF + html2canvas (no server, no Playwright)
- Element-aware pagination — no element is split across pages
- Customer-facing invoice with configurable layout, taxes, and notes
- Images embedded as proper PDF objects (no base64 leaks)
- **Quote vs Invoice distinction** — same shape, different document-number prefix (`QUO-` vs `INV-`) and PDF heading; one-click "Convert to invoice"
- **Per-line discounts** — percent or fixed amount; reflected in line totals, subtotal, taxes, and PDF

### 🎨 Receipt Layout Editor
- Drag-and-drop element reordering (Angular CDK)
- Add custom text blocks, images, dividers, and totals
- Per-element style control: font size stepper, color picker, image width/height/fit/alignment/radius
- Live preview that matches PDF output exactly
- Layout persisted to localStorage

### 👥 Customer Book & Invoice History
- Maintain a reusable customer book (name, tax id, email, phone, address, notes)
- "Use for active invoice" copies customer fields onto the invoice meta in one click
- Saved-invoice history panel — click "Clone to editor" to load any past invoice back into the active editor (with a new id, so the original is preserved)
- Quote/invoice badge on each saved document card

### ⭐ Catalog Favorites
- Star icon on every product card to mark favorites
- "Show only favorites" filter in the catalog sidebar (with count)
- Persisted in localStorage across reloads

### 🔔 Toast Notifications
- App-wide toast service with success / info / warn / error kinds
- Mounted once in `app.html` (`<app-toaster>`)
- Auto-dismiss with configurable TTL; manual dismiss button
- Routes existing success/error paths (PDF, upload, save, favorite, add-to-invoice) through the toast queue

### 📊 Excel Import / Export
- Downloadable localized template (Turkish + English column headers)
- Cross-language parser — Turkish-uploaded file works with English UI
- Import preview with per-row action labels (New family / Update family / New variant / Update variant)
- Conflict detection (duplicate codes, duplicate SKUs, name mismatches)
- Row selection — choose which rows to import
- Merge mode (keep existing catalog) or Replace mode (wipe and replace)
- Export to XLSX or CSV with family selection

### 🌍 Internationalization (i18n)
- English + Turkish with runtime switching
- `APP_INITIALIZER` loads translations before first paint — no key flashing
- All UI text, error messages, and Excel template headers are localized
- `<html lang>` attribute stays in sync with the active language (screen-reader friendly)

### 🎨 Theming
- Light / Dark / System theme with `data-theme` attribute
- CSS custom properties for all colors, spacing, typography, and motion
- `color-scheme: dark` for native form controls

### 💱 Currency Conversion
- USD / TRY / EUR with user-configurable exchange rates
- `CurrencyService.convert()` routes through USD as pivot currency

### 🔄 Auto-Update (Tauri only)
- Check for updates from GitHub Releases
- Download with progress bar
- Install and restart — powered by `tauri-plugin-updater`

### 📱 Responsive Design
- Desktop: collapsible sidebar with hover-to-reveal toggle
- Mobile: slide-in drawer with backdrop + top bar
- All pages optimized for touch (≤768px breakpoints)
- Shell-level `overflow-x: hidden` so any in-page horizontal overflow stays on the page (no leaky shell scrollbars)

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Angular v22 (zoneless, standalone components) |
| Control flow | `@if` / `@for` / `@switch` (no `*ngIf` / `*ngFor`) |
| State | Signals (`signal()`, `computed()`, `effect()`) |
| Desktop | Tauri v2 (minimal Rust — ~50 lines) |
| i18n | @ngx-translate/core v16 |
| Drag-drop | @angular/cdk v22 |
| PDF | jsPDF + html2canvas |
| Excel | SheetJS (xlsx) |
| Storage | IndexedDB (web) / Tauri fs (desktop) |
| Icons | Self-hosted SVG registry (31 icons, 16 KB) |
| Linting | ESLint + angular-eslint |
| Testing | Vitest (76 tests) |

**No Angular Material. No Angular Animations. No NgModules. No zone.js. No server-side rendering.**

## Architecture

```
playforge/
├── src/
│   └── app/
│       ├── core/
│       │   ├── models/           # Type-safe domain models
│       │   ├── services/         # Focused services (catalog, configurator,
│       │   │                     # invoice, customers, favorites, toast, ...)
│       │   └── utils/            # Shared utility functions
│       ├── features/             # Lazy-loaded pages
│       │   ├── catalog/          # Browse products (with favorites filter)
│       │   ├── configurator/     # Parts-based builder
│       │   ├── invoice/          # Invoice + PDF export (quote/invoice + discounts)
│       │   ├── customers/        # Customer book + saved invoice history
│       │   ├── receipt-editor/   # Drag-drop layout editor
│       │   ├── import/           # Excel import wizard
│       │   ├── export/           # Excel/CSV export
│       │   ├── catalog-management/ # CRUD for families/variants/parts
│       │   └── settings/         # Theme, language, currency, updates
│       └── shared/
│           ├── components/       # Icon, Button, ResolvedImg, ReceiptPreview, Toaster
│           └── pipes/            # MoneyPipe
│
├── src-tauri/                    # Tauri backend (~50 lines Rust)
│   ├── src/
│   │   ├── main.rs              # Entry point (3 lines)
│   │   └── lib.rs               # Plugin registration + update commands
│   ├── Cargo.toml               # tauri, fs, dialog, updater, process
│   ├── tauri.conf.json          # Window config + updater endpoints
│   └── capabilities/default.json # Permissions
│
├── eslint.config.mjs             # ESLint + angular-eslint
└── package.json
```

### File Storage Abstraction

```
FileStorageAdapter (abstract)
├── BrowserFileStorageAdapter  → IndexedDB + blob: URL (web)
└── TauriFileStorageAdapter    → Tauri fs plugin + asset:// URL (desktop)
```

Switching between web and Tauri is a single DI provider change in `app.config.ts` — no other code changes needed.

### Reverse-Match Algorithm

When a user manually selects parts in the configurator, the algorithm:
1. Skips the variant that was explicitly loaded (no redundant "you're on this variant")
2. Only suggests when the user has selected at least one optional part
3. Finds the closest variant by SKU delta (≤3 difference for partial matches)
4. Returns `exact`, `partial`, or `none`

## Getting Started

### Web Mode (Development)

```bash
npm install
npm start          # http://localhost:4200
```

### Tauri Mode (Desktop App)

**Prerequisites (Linux):**
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev pkg-config
```

```bash
npm install
npm run tauri:dev    # Development with hot reload
npm run tauri:build  # Production build → installer (.deb/.AppImage/.msi/.dmg)
```

### Testing & Linting

```bash
npm test            # 76 unit tests (Vitest)
npm run lint        # ESLint check
npm run lint:fix    # ESLint auto-fix
```

## License

MIT

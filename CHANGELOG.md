# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Added

- **Customer Book & Invoice History**:
  - Implemented a customer book to save and reuse client contact information (name, tax ID, email, phone, address, notes).
  - Added "Use for active invoice" action to apply saved customer details to the current invoice with a single click.
  - Implemented a saved invoice history panel supporting cloning past invoices into the editor as new documents.
- **Catalog Favorites**:
  - Added ability to mark product variants as favorites with a star icon.
  - Introduced a "Show only favorites" filter in the catalog sidebar with reactive count badges.
  - Persisted favorites list in `localStorage`.
- **Toast Notifications**:
  - Added a global `ToastService` and `<app-toaster>` component to display success, info, warning, and error notifications.
  - Routed PDF generation success/errors, Excel uploads, invoice saving, and catalog favoriting events through the toast system.
- **Quote vs Invoice Toggle**:
  - Added support for switching document type between quotes (`QUO-` prefix) and invoices (`INV-` prefix).
  - Dynamically updates headings in both the editor, preview, and exported PDF.
- **Per-Line Discounts**:
  - Added support for line item discounts (percentage or fixed amount) which automatically recalculate line totals, subtotals, taxes, and render in the exported PDF.
- **Icon Generation Utility**:
  - Created `scripts/generate-icons.mjs` to automate building SVG icons and updating the local registry.

### Changed

- **Receipt Layout Editor**:
  - Refactored layout model to use drag-and-drop ordering powered by Angular CDK.
  - Allowed custom layout elements (text blocks, image galleries, notes, dividers) to be added, styled, and reordered.
- **Language Synchronization**:
  - Automatically syncs the `<html lang>` attribute with the active interface language (Turkish/English) for better accessibility.
- **UI & Layout Optimizations**:
  - Implemented shell-level horizontal overflow prevention (`overflow-x: hidden`) to avoid page layout shifts.
  - Refined mobile navigation drawer backdrop behavior and responsive scaling.

### Fixed

- **Seller Block PDF Export**:
  - Fixed an issue where the seller block was missing from the exported PDF. Corrected the HTML builder to use logical OR (`||`) instead of nullish coalescing (`??`) for the layout element content fallback, matching the live preview.
- **ESLint & TS Configuration**:
  - Addressed various TS rules and configured explicit rules for optional chaining, nullish coalescing, and promise rejection errors.

---

## [0.1.0] - 2026-07-03

### Added

- Initial release of **PlayForge**.
- Client-side PDF generation via jsPDF and html2canvas.
- Excel spreadsheet import/export with cross-language support.
- Configurator for product variant configurations.
- Light/Dark/System theme switcher.
- Turkish and English localization support.

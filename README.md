# ParkMan

ParkMan is a modern desktop application for product management and invoice generation, built with **Angular** and **Tauri**.

## Features

- 📦 **Product Management**: Create, edit, and search products with support for multiple images and primary selection.
- 🧾 **Dynamic Invoice Engine**: Customizable invoice layouts with a live preview. Drag-and-drop elements to reorder.
- 🌍 **Multi-language Support**: Fully translated into English and Turkish, with language preferences saved to the system.
- 🖨️ **Print & Export**: Generate print-ready invoices directly from the application.
- ⚙️ **Persistent Settings**: Custom sidebar width, language preferences, and invoice layouts are saved using a local SQLite backend.
- 🚀 **Desktop Native**: Single-instance support, native titlebar controls (on desktop), and file system integration.

## Tech Stack

- **Frontend**: [Angular](https://angular.io/) (v21), [Angular Material](https://material.angular.io/), [SCSS](https://sass-lang.com/), [ngx-translate](https://github.com/ngx-translate/core).
- **Backend**: [Tauri](https://tauri.app/) (Rust), [SQLite](https://www.sqlite.org/) for local data persistence.
- **Plugins**: Single-instance, Dialog, Opener, OS.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/) and the [Tauri prerequisites](https://tauri.app/guides/getting-started/prerequisites)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run in development mode:
   ```bash
   npm run tauri dev
   ```

### Building

To build the production bundle:
```bash
npm run tauri build
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template)

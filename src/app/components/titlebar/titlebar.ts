import { Component, signal, inject, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatMenuModule } from "@angular/material/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TranslateService, TranslateModule } from "@ngx-translate/core";
import { invoke } from "@tauri-apps/api/core";

@Component({
  selector: "app-titlebar",
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TranslateModule,
  ],
  templateUrl: "./titlebar.html",
  styleUrls: ["./titlebar.scss"],
})
export class TitlebarComponent {
  isMaximized = signal(false);
  private translate = inject(TranslateService);

  currentLang = signal<string>('en');

  constructor() {
    this.checkMaximized();
    getCurrentWindow().listen("tauri://resize", () => {
      this.checkMaximized();
    });

    // Initialize current language
    this.currentLang.set(this.translate.currentLang || this.translate.defaultLang || 'en');

    // Subscribe to language changes
    this.translate.onLangChange.subscribe((event) => {
      this.currentLang.set(event.lang);
    });
  }

  async checkMaximized() {
    const maximized = await getCurrentWindow().isMaximized();
    this.isMaximized.set(maximized);
  }

  minimize() {
    getCurrentWindow().minimize();
  }

  async maximize() {
    const window = getCurrentWindow();
    const maximized = await window.isMaximized();
    if (maximized) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }

  close() {
    getCurrentWindow().close();
  }

  async switchLanguage(lang: string) {
    this.translate.use(lang);
    try {
      await invoke("save_setting", {
        key: "app_language",
        value: lang,
      });
    } catch (error) {
      console.error("Failed to save language preference:", error);
    }
  }
}

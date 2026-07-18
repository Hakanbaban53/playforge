import { Component, inject, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DataProvider } from '../../core/services/data-provider';
import { IconComponent } from './icon.component';

/**
 * Sync indicator — shows the current sync state in the sidebar footer.
 *
 * Four states:
 *   - local   — anonymous mode, no cloud. "Saved locally" with a disk icon.
 *   - synced  — cloud mode, all writes confirmed. "Saved" with a check.
 *   - syncing — cloud mode, writes pending. "Saving…" with a spinner.
 *   - offline — cloud mode, network unreachable. "Offline" with a cloud-off.
 *
 * The component reads `DataProvider.syncState` directly — the provider
 * aggregates per-collection metadata into a single signal.
 */
@Component({
  selector: 'app-sync-indicator',
  standalone: true,
  imports: [TranslatePipe, IconComponent],
  template: `
    <div
      class="sync-indicator"
      [class]="'sync-indicator--' + state()"
      [title]="tooltip()"
    >
      <app-icon
        [name]="iconName()"
        [size]="14"
        [class.sync-indicator__spin]="state() === 'syncing'"
      />
      <span class="sync-indicator__label">{{ labelKey() | translate }}</span>
    </div>
  `,
  styles: [`
    .sync-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--sidebar-text-muted);
      background: rgba(255, 255, 255, 0.05);
      padding: 5px 10px;
      border-radius: 999px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
      transition: background var(--motion-fast), color var(--motion-fast);

      &--syncing {
        color: #fff;
        background: rgba(56, 181, 103, 0.18);
        box-shadow: 0 0 0 1px rgba(56, 181, 103, 0.35);
      }

      &--offline {
        color: var(--warn-500);
        background: rgba(245, 158, 11, 0.12);
        box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3);
      }

      &__label {
        line-height: 1;
        white-space: nowrap;
      }

      &__spin {
        animation: var(--motion-spin);
      }
    }
  `],
})
export class SyncIndicatorComponent {
  private readonly data = inject(DataProvider);

  readonly state = computed(() => this.data.syncState());

  readonly iconName = computed<string>(() => {
    switch (this.state()) {
      case 'local':   return 'cloud_off';
      case 'synced':  return 'cloud_done';
      case 'syncing': return 'sync';
      case 'offline': return 'cloud_off';
      default:        return 'cloud';
    }
  });

  readonly labelKey = computed<string>(() => {
    switch (this.state()) {
      case 'local':   return 'sync.local';
      case 'synced':  return 'sync.synced';
      case 'syncing': return 'sync.syncing';
      case 'offline': return 'sync.offline';
      default:        return 'sync.local';
    }
  });

  readonly tooltip = computed<string>(() => {
    const s = this.state();
    if (s === 'local') return 'Data is saved only on this device. Sign in to sync across devices.';
    if (s === 'syncing') return 'Saving changes to the cloud…';
    if (s === 'offline') return 'Offline — changes will sync when reconnected.';
    return 'All changes saved to the cloud.';
  });
}

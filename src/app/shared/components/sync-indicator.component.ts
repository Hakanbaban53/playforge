import { Component, inject, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DataProvider } from '../../core/services/data-provider';
import { ImageSyncQueueService } from '../../core/services/image-sync-queue.service';
import { IconComponent } from './icon.component';
import { SpinnerComponent } from './spinner.component';

/**
 * Sync status indicator — reflects Firestore sync state AND image
 * sync queue state.
 *
 * The indicator shows "syncing" when EITHER:
 *   - Firestore has pending writes (documents being synced), OR
 *   - The image sync queue is processing items (uploads/deletes).
 *
 * This gives the user unified feedback: any cloud sync activity
 * (document writes or image uploads) shows the syncing state.
 */
@Component({
  selector: 'app-sync-indicator',
  standalone: true,
  imports: [TranslatePipe, IconComponent, SpinnerComponent],
  template: `
    <div
      class="sync-indicator"
      [class]="'sync-indicator--' + state()"
      [title]="tooltip()"
    >
      @if (state() === 'syncing') {
        <app-spinner [size]="14" />
      } @else {
        <app-icon [name]="iconName()" [size]="14" />
      }
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
    }
  `],
})
export class SyncIndicatorComponent {
  private readonly data = inject(DataProvider);
  private readonly imageSync = inject(ImageSyncQueueService);

  /** Combined sync state: Firestore + image sync queue. */
  readonly state = computed(() => {
    const firestoreState = this.data.syncState();
    const imageActive = this.imageSync.activeCount();
    const imageSyncing = this.imageSync.isSyncing();

    // Image sync activity overrides to 'syncing'.
    if (imageSyncing || imageActive > 0) {
      return 'syncing' as const;
    }
    return firestoreState;
  });

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
    const imageActive = this.imageSync.activeCount();
    if (s === 'local') return 'Data is saved only on this device. Sign in to sync across devices.';
    if (s === 'syncing') {
      if (imageActive > 0) {
        return `Syncing ${imageActive} image(s) to the cloud…`;
      }
      return 'Saving changes to the cloud…';
    }
    if (s === 'offline') return 'Offline — changes will sync when reconnected.';
    return 'All changes saved to the cloud.';
  });
}

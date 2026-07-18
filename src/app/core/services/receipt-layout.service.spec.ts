import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ReceiptLayoutService } from './receipt-layout.service';
import { provideInMemoryDataAndStubAuth } from './testing';

/**
 * ReceiptLayoutService tests — covers default layout, add/remove/toggle
 * elements, style updates, and persistence.
 */
describe('ReceiptLayoutService', () => {
  let service: ReceiptLayoutService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({}),
        ...provideInMemoryDataAndStubAuth(),
      ],
    });
    service = TestBed.inject(ReceiptLayoutService);
  });

  it('starts with the default layout (7 fixed elements)', () => {
    const layout = service.layout();
    expect(layout.length).toBe(7);
    expect(layout.map((el) => el.id)).toEqual([
      'header', 'meta', 'table', 'totals', 'notes', 'terms', 'visuals',
    ]);
    expect(layout.every((el) => el.fixed)).toBe(true);
  });

  it('exposes the layout via the reactive signal', () => {
    // The layout is backed by DataProvider.doc() — the spec doesn't
    // verify localStorage directly because the stub DataProvider is
    // in-memory. Reading the signal confirms the layout is initialized.
    expect(service.layout().length).toBe(7);
  });

  it('addElement(text) appends a new text element with default styles', async () => {
    const id = await service.addElement('text');
    const layout = service.layout();
    expect(layout.length).toBe(8);
    const added = layout.find((el) => el.id === id);
    expect(added).toBeDefined();
    expect(added!.type).toBe('text');
    expect(added!.fixed).toBeFalsy();
    expect(added!.styles?.fontSize).toBe('14px');
  });

  it('addElement(image) appends a new image element with image styles', async () => {
    const id = await service.addElement('image');
    const added = service.layout().find((el) => el.id === id);
    expect(added!.styles?.imageFit).toBe('contain');
  });

  it('addElement(totals) appends a new totals element (draggable, removable)', async () => {
    const id = await service.addElement('totals');
    const added = service.layout().find((el) => el.id === id);
    expect(added!.type).toBe('totals');
    expect(added!.fixed).toBeFalsy();
    expect(service.isRemovable(added!)).toBe(true);
  });

  it('removeElement() removes user-added elements but not fixed ones', async () => {
    const id = await service.addElement('text');
    expect(service.layout().length).toBe(8);

    const removed = await service.removeElement(id);
    expect(removed).toBe(true);
    expect(service.layout().length).toBe(7);

    const fixedRemoved = await service.removeElement('header');
    expect(fixedRemoved).toBe(false);
    expect(service.layout().length).toBe(7);
  });

  it('toggleVisibility() flips the visible flag', async () => {
    const before = service.layout().find((el) => el.id === 'header')!.visible;
    await service.toggleVisibility('header');
    const after = service.layout().find((el) => el.id === 'header')!.visible;
    expect(after).toBe(!before);
  });

  it('updateElement() applies a partial patch', async () => {
    await service.updateElement('header', { content: 'New header text' });
    const el = service.layout().find((e) => e.id === 'header');
    expect(el!.content).toBe('New header text');
  });

  it('updateStyle() sets a style key', async () => {
    await service.updateStyle('header', 'fontSize', '24px');
    const el = service.layout().find((e) => e.id === 'header');
    expect(el!.styles?.fontSize).toBe('24px');
  });

  it('updateStyle() with empty string removes the override (default re-applied)', async () => {
    await service.updateStyle('header', 'fontSize', '24px');
    expect(service.layout().find((e) => e.id === 'header')!.styles?.fontSize).toBe('24px');
    await service.updateStyle('header', 'fontSize', '');
    // The override is removed, so normalize() re-applies the default.
    const fontSize = service.layout().find((e) => e.id === 'header')!.styles?.fontSize;
    expect(fontSize).toBeTruthy(); // default value, not '24px'
    expect(fontSize).not.toBe('24px');
  });

  it('reorder() persists the new order', async () => {
    const original = service.layout();
    const reordered = [original[1], original[0], ...original.slice(2)];
    await service.reorder(reordered);
    expect(service.layout()[0].id).toBe('meta');
    expect(service.layout()[1].id).toBe('header');
  });

  it('resetToDefault() restores the 7 default elements', async () => {
    await service.addElement('text');
    await service.addElement('image');
    expect(service.layout().length).toBe(9);
    await service.resetToDefault();
    expect(service.layout().length).toBe(7);
  });

  it('isRemovable() returns false for fixed elements', () => {
    const header = service.layout().find((e) => e.id === 'header')!;
    expect(service.isRemovable(header)).toBe(false);
  });

  it('isContentEditable() returns true for text/image/header types', () => {
    const header = service.layout().find((e) => e.id === 'header')!;
    expect(service.isContentEditable(header)).toBe(true);
    const table = service.layout().find((e) => e.id === 'table')!;
    expect(service.isContentEditable(table)).toBe(false);
  });
});

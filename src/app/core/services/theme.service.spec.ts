import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

/**
 * ThemeService tests — covers mode switching, persistence, and the
 * `data-theme` attribute applied to the root element.
 */
describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system mode when nothing is stored', () => {
    service = TestBed.inject(ThemeService);
    expect(service.mode()).toBe('system');
  });

  it('setMode() persists the choice and applies the resolved theme', () => {
    service = TestBed.inject(ThemeService);
    service.setMode('dark');
    expect(service.mode()).toBe('dark');
    expect(service.resolved()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('pgpos:theme')).toBe('dark');
  });

  it('setMode(light) applies the light theme', () => {
    service = TestBed.inject(ThemeService);
    service.setMode('light');
    expect(service.resolved()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggle() flips between light and dark', () => {
    service = TestBed.inject(ThemeService);
    service.setMode('light');
    service.toggle();
    expect(service.mode()).toBe('dark');
    service.toggle();
    expect(service.mode()).toBe('light');
  });

  it('reads stored mode on instantiation', () => {
    localStorage.setItem('pgpos:theme', 'dark');
    service = TestBed.inject(ThemeService);
    expect(service.mode()).toBe('dark');
  });
});

import { Pipe, PipeTransform } from '@angular/core';

/**
 * Title-case a string. Used to render category enums nicely.
 *   'merry-go-round' → 'Merry-Go-Round'
 */
@Pipe({ name: 'titlecaseEnum' })
export class TitlecaseEnumPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    return value
      .split('-')
      .map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
      .join('-');
  }
}

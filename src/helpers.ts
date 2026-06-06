/**
 * helpers.ts
 * Funciones helpers compartidas entre componentes.
 */
import { TagType } from './types';

export function getTagColor(tag: TagType) {
  switch (tag) {
    case 'con_hora': return 'turquesa';
    case 'focus': return 'azul';
    case 'dirección': return 'morado';
    case 'espera': return 'naranja';
    case 'resto': return 'turquesa';
    default: return 'text-secondary';
  }
}

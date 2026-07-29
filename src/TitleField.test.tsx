// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitleField } from './TitleField';

/**
 * Regresión sesión 15 — "cada letra me saca del campo".
 *
 * El harness reproduce EXACTAMENTE el cableado de la app: guardar (onCommit) también APAGA la
 * edición, igual que hacía handleUpdateTask. Si el campo guardara en cada pulsación (el bug), la
 * edición se apagaría a mitad de tecleo y el <input> se desmontaría → imposible teclear seguido.
 * Con el borrador local, teclear NO guarda: el <input> se mantiene montado y enfocado.
 */
function Harness({ onCommitSpy }: { onCommitSpy?: (v: string) => void }) {
  const [value, setValue] = useState('Hola');
  const [editing, setEditing] = useState(true);
  return (
    <TitleField
      value={value}
      editing={editing}
      onStartEdit={() => setEditing(true)}
      onCommit={(v) => { onCommitSpy?.(v); setValue(v); setEditing(false); }}
      onCancel={() => setEditing(false)}
      inputClassName="title-input"
      spanClassName="title-span"
    />
  );
}

describe('TitleField — teclear varias letras seguidas en el título', () => {
  it('teclea 3 letras sin perder el foco ni desmontarse, y el valor son las 3 letras', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness onCommitSpy={onCommit} />);

    const input = screen.getByPlaceholderText('Título de la tarea...') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    await user.type(input, 'abc');

    // El MISMO input sigue montado y enfocado tras teclear 3 letras seguidas.
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    // El valor final contiene las tres letras.
    expect(input.value).toBe('Holaabc');
    // Y NO se ha guardado nada durante el tecleo (sin re-render de la fila por pulsación).
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('guarda una sola vez, con el valor final, al salir del campo (blur)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness onCommitSpy={onCommit} />);

    const input = screen.getByPlaceholderText('Título de la tarea...') as HTMLInputElement;
    await user.type(input, 'abc');
    await user.tab(); // blur

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Holaabc');
  });

  it('Enter guarda el valor final una sola vez', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness onCommitSpy={onCommit} />);

    const input = screen.getByPlaceholderText('Título de la tarea...') as HTMLInputElement;
    await user.type(input, 'xyz{Enter}');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Holaxyz');
  });

  it('Escape descarta el borrador y no guarda', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness onCommitSpy={onCommit} />);

    const input = screen.getByPlaceholderText('Título de la tarea...') as HTMLInputElement;
    await user.type(input, 'zzz{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
  });
});

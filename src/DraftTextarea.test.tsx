// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftTextarea } from './DraftTextarea';

/**
 * §16.130 — "cada letra que escribo dispara una escritura".
 * La nota de reunión llamaba a onUpdateMeetings en cada pulsación, y esa función escribía en
 * Supabase (y hasta §16.130 barría filas). Aquí se comprueba que teclear NO guarda.
 */
function Harness({ spy, onUnmountValue }: { spy: (v: string) => void; onUnmountValue?: boolean }) {
  const [montado, setMontado] = useState(true);
  return (
    <div>
      {montado && <DraftTextarea initial="" onCommit={spy} retardoMs={100000} placeholder="Nota" />}
      {onUnmountValue && <button onClick={() => setMontado(false)}>plegar</button>}
    </div>
  );
}

afterEach(() => cleanup());

describe('§16.130 DraftTextarea: la nota no se guarda por tecla', () => {
  it('teclear no guarda ni una vez; al salir del campo guarda UNA', async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<div><Harness spy={spy} /><button>fuera</button></div>);
    const campo = screen.getByPlaceholderText('Nota');
    await user.click(campo);
    await user.keyboard('Dijo que lo revisa el lunes');
    expect(spy).not.toHaveBeenCalled();           // 27 letras, 0 escrituras
    await user.click(screen.getByText('fuera'));  // blur
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Dijo que lo revisa el lunes');
  });

  it('salir sin cambios no guarda nada', async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<div><DraftTextarea initial="ya escrita" onCommit={spy} placeholder="Nota" /><button>fuera</button></div>);
    await user.click(screen.getByPlaceholderText('Nota'));
    await user.click(screen.getByText('fuera'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('si el campo se desmonta con texto sin guardar, no se pierde', async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<Harness spy={spy} onUnmountValue />);
    await user.click(screen.getByPlaceholderText('Nota'));
    await user.keyboard('a medias');
    await user.click(screen.getByText('plegar'));  // se desmonta sin blur previo
    expect(spy).toHaveBeenCalledWith('a medias');
  });

  it('con retardo corto, guarda sola tras la pausa (una vez, no por letra)', async () => {
    const spy = vi.fn();
    const user = userEvent.setup();
    render(<DraftTextarea initial="" onCommit={spy} retardoMs={50} placeholder="Nota" />);
    await user.click(screen.getByPlaceholderText('Nota'));
    await user.keyboard('hola');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1)); // UNA, no cuatro (una por letra)
    expect(spy).toHaveBeenCalledWith('hola');
  });
});

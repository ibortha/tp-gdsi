import { ArrowCounterClockwise, CaretDown } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { currentPersona, personas, resetDemo, type Persona } from './backend.ts';

/** Barra fija de la demo: permite "ser" cualquier comensal, el mozo o el ADMIN con datos de prueba. */
export default function DemoBar() {
  const [list, setList] = useState<Persona[]>(() => personas());
  const [current, setCurrent] = useState(() => currentPersona());

  useEffect(() => {
    const refresh = () => {
      setList(personas());
      setCurrent(currentPersona());
    };
    window.addEventListener('hashchange', refresh);
    const id = window.setInterval(refresh, 3000);
    return () => {
      window.removeEventListener('hashchange', refresh);
      window.clearInterval(id);
    };
  }, []);

  const groups = [...new Set(list.map((p) => p.group))];
  const known = list.some((p) => p.value === current);

  return (
    <div className="demo-bar" role="region" aria-label="Demo con datos de prueba">
      <span className="demo-bar__tag">
        <span className="demo-bar__dot" />
        Demo
      </span>
      <label className="demo-bar__select">
        <span className="demo-bar__label">Ver como</span>
        <select
          value={known ? current : ''}
          onChange={(e) => list.find((p) => p.value === e.target.value)?.apply()}
          aria-label="Cambiar de vista"
        >
          {!known && <option value="">Elegí una vista…</option>}
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {list
                .filter((p) => p.group === g)
                .map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <CaretDown size={14} weight="bold" />
      </label>
      <button
        className="demo-bar__reset"
        onClick={() => {
          if (window.confirm('¿Volver a los datos de prueba originales? Se pierde todo lo que hiciste en la demo.')) resetDemo();
        }}
        title="Reiniciar datos de prueba"
        aria-label="Reiniciar datos de prueba"
      >
        <ArrowCounterClockwise size={16} weight="bold" />
        <span className="demo-bar__reset-label">Reiniciar</span>
      </button>
    </div>
  );
}

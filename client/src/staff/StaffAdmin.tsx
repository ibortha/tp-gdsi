import { Key, Plus, Trash } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import type { Role, StaffUserDTO } from '../../../shared/types.ts';
import { Loader, Segmented, Switch, useAction, useConfirm } from '../components/ui.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';

export function StaffAdmin() {
  useDocumentTitle('Personal · Pedido Grupal');
  const { call, user: me } = useStaff();
  const { data: users, reload } = useStaffData<StaffUserDTO[]>('/api/admin/staff');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MOZO' as Role });
  if (!users) return <Loader />;

  const update = (u: StaffUserDTO, body: Partial<StaffUserDTO> & { password?: string }, ok?: string) =>
    run(async () => {
      await call(`/api/admin/staff/${u.id}`, { method: 'PATCH', body });
      reload();
    }, ok);

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await call('/api/admin/staff', { body: form });
      setForm({ name: '', email: '', password: '', role: 'MOZO' });
      reload();
    }, 'Usuario creado');
  };

  const resetPassword = async (u: StaffUserDTO) => {
    const password = window.prompt(`Nueva contraseña para ${u.name} (mínimo 6 caracteres)`);
    if (password) await update(u, { password }, 'Contraseña actualizada');
  };

  const remove = async (u: StaffUserDTO) => {
    if (await confirm({ title: `Eliminar a ${u.name}`, message: 'Pierde el acceso al panel de inmediato.', confirmLabel: 'Eliminar', danger: true }))
      await run(async () => {
        await call(`/api/admin/staff/${u.id}`, { method: 'DELETE' });
        reload();
      }, 'Usuario eliminado');
  };

  return (
    <>
      <header className="s-head">
        <div className="stack stack-2">
          <span className="eyebrow">{users.length} personas</span>
          <h1 className="display s-title">Personal</h1>
          <p className="small muted" style={{ maxWidth: '60ch' }}>
            <strong>Mozo</strong> ve el salón y las comandas y confirma cobros. <strong>ADMIN</strong> además edita la carta, las mesas,
            el personal y ve las métricas.
          </p>
        </div>
      </header>

      <section className="panel">
        <ul className="admin-list">
          {users.map((u) => (
            <li key={u.id} className="admin-row">
              <span className="s-user__avatar mono" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
                {u.name.charAt(0)}
              </span>
              <div className="grow stack" style={{ gap: 2, minWidth: 180 }}>
                <strong>
                  {u.name} {u.id === me.id && <span className="tag">vos</span>}
                </strong>
                <span className="small muted mono">{u.email}</span>
              </div>
              <div style={{ width: 190 }}>
                <Segmented<Role>
                  label={`Rol de ${u.name}`}
                  value={u.role}
                  onChange={(role) => !busy && update(u, { role })}
                  options={[
                    { value: 'MOZO', label: 'Mozo' },
                    { value: 'ADMIN', label: 'ADMIN' },
                  ]}
                />
              </div>
              <Switch checked={u.active} disabled={busy || u.id === me.id} label={u.active ? 'Activo' : 'Inactivo'} onChange={(active) => update(u, { active })} />
              <div className="row" style={{ gap: 2 }}>
                <button className="btn btn--ghost btn--icon btn--sm" onClick={() => resetPassword(u)} title="Cambiar contraseña" aria-label={`Cambiar contraseña de ${u.name}`}>
                  <Key size={16} />
                </button>
                {u.id !== me.id && (
                  <button className="btn btn--ghost btn--icon btn--sm" onClick={() => remove(u)} title="Eliminar" aria-label={`Eliminar a ${u.name}`}>
                    <Trash size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form className="panel" onSubmit={add}>
        <header className="panel__head">
          <h2>Sumar a alguien</h2>
        </header>
        <div className="form-grid form-grid--4" style={{ padding: '0 20px 20px' }}>
          <label className="field">
            <span className="field__label">Nombre</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} />
          </label>
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field__label">Contraseña inicial</span>
            <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          </label>
          <div className="field">
            <span className="field__label">Rol</span>
            <Segmented<Role>
              label="Rol"
              value={form.role}
              onChange={(role) => setForm({ ...form, role })}
              options={[
                { value: 'MOZO', label: 'Mozo' },
                { value: 'ADMIN', label: 'ADMIN' },
              ]}
            />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', padding: '0 20px 20px' }}>
          <button className="btn btn--ink" disabled={busy}>
            <Plus size={16} weight="bold" /> Registrar
          </button>
        </div>
      </form>
    </>
  );
}

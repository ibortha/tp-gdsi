import { useState, type FormEvent } from 'react';
import type { Role, StaffUserDTO } from '../../../shared/types.ts';
import { Spinner, Switch, useAction, useConfirm } from '../components/ui.tsx';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useStaff, useStaffData } from './context.tsx';

export function StaffAdmin() {
  useDocumentTitle('Personal · Pedido Grupal');
  const { call, user: me } = useStaff();
  const { data: users, reload } = useStaffData<StaffUserDTO[]>('/api/admin/staff');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MOZO' as Role });
  if (!users) return <Spinner />;

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
    if (await confirm({ title: `Eliminar a ${u.name}`, confirmLabel: 'Eliminar', danger: true }))
      await run(async () => {
        await call(`/api/admin/staff/${u.id}`, { method: 'DELETE' });
        reload();
      }, 'Usuario eliminado');
  };

  return (
    <>
      <div className="page-head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Personal</h1>
          <span className="small muted">
            El rol <strong>MOZO</strong> ve mesas y comandas y confirma cobros. El <strong>ADMIN</strong> además edita el menú,
            las mesas, el personal y ve las métricas.
          </span>
        </div>
      </div>

      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.name}</strong>
                  {u.id === me.id && <span className="badge" style={{ marginLeft: 6 }}>vos</span>}
                </td>
                <td className="small">{u.email}</td>
                <td>
                  <select className="input" style={{ minHeight: 36, width: 'auto' }} value={u.role} disabled={busy} onChange={(e) => update(u, { role: e.target.value as Role })}>
                    <option value="MOZO">MOZO</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td>
                  <Switch checked={u.active} disabled={busy || u.id === me.id} label={u.active ? 'Activo' : 'Inactivo'} onChange={(active) => update(u, { active })} />
                </td>
                <td>
                  <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(u)}>
                      Cambiar contraseña
                    </button>
                    {u.id !== me.id && (
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(u)}>
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card card-pad stack" onSubmit={add}>
        <h2>Registrar mesero / admin</h2>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow" style={{ minWidth: 160 }}>
            <span>Nombre</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={60} />
          </label>
          <label className="field grow" style={{ minWidth: 200 }}>
            <span>Email</span>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field grow" style={{ minWidth: 160 }}>
            <span>Contraseña inicial</span>
            <input className="input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          </label>
          <label className="field" style={{ width: 130 }}>
            <span>Rol</span>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="MOZO">MOZO</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy}>
            Registrar
          </button>
        </div>
      </form>
    </>
  );
}

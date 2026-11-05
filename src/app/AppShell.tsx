import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, LogOut, Menu, X, UserCircle2 } from 'lucide-react';
import { useAuth } from '@core/auth/AuthProvider';
import { useModules } from '@core/modules/registry';
import { Slot } from '@core/modules/Slot';
import type { NavGroup, NavItem } from '@core/modules/types';
import { brand } from '@core/config';
import { cx } from '@core/ui/primitives';
import { NotificationBell } from '../core-modules/notifications/Bell';

const GROUPS: { id: NavGroup; label: string }[] = [
  { id: 'principal', label: '' },
  { id: 'operaciones', label: 'Operaciones' },
  { id: 'flota', label: 'Flota' },
  { id: 'taller', label: 'Taller' },
  { id: 'administracion', label: 'Administración' },
];

function useNav() {
  const { modules } = useModules();
  const { can } = useAuth();
  return modules.flatMap((m) => m.nav ?? []).filter((n) => can(n.perm)).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="space-y-5">
      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g.id);
        if (!list.length) return null;
        return (
          <div key={g.id}>
            {g.label && <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/35">{g.label}</div>}
            <ul className="space-y-0.5">
              {list.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} onClick={onNavigate} end={n.to === '/m'}
                    className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-[14px] transition-colors',
                      isActive ? 'bg-white/10 font-medium text-white' : 'text-rail-text hover:bg-white/5 hover:text-white')}>
                    {({ isActive }) => <><n.icon className={cx('size-[18px]', isActive && 'text-brand')} />{n.label}</>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function AppShell({ home }: { home: string }) {
  const { profile, logout } = useAuth();
  const items = useNav();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [loc.pathname]);

  const mobileItems = items.filter((i) => i.mobile && i.to !== home).slice(0, 3);
  const UserBlock = (
    <div className="border-t border-white/10 p-3">
      <NavLink to="/perfil" className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-white/5">
        <UserCircle2 className="size-8 text-rail-text" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{profile!.full_name}</div>
          <div className="truncate text-xs text-rail-text">{profile!.role_name} · <span className="font-mono">{profile!.employee_code}</span></div>
        </div>
      </NavLink>
      <button onClick={logout} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-rail-text hover:bg-white/5 hover:text-white">
        <LogOut className="size-4" />Cerrar sesión
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh md:pl-[240px]">
      {/* Barra lateral (escritorio) */}
      <aside className="fixed top-[var(--demo-h,0px)] bottom-0 left-0 z-30 hidden w-[240px] flex-col bg-rail md:flex">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <div className="grid size-8 place-items-center rounded-md bg-brand font-mono text-xs font-bold text-white">{brand.shortName.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{brand.name}</div>
            <div className="truncate text-[11px] text-rail-text">{brand.company}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-3"><NavList items={items} /></div>
        {UserBlock}
      </aside>

      {/* Barra superior */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-paper/90 px-3 backdrop-blur md:px-6">
        <button className="-ml-1 rounded-md p-2 md:hidden" onClick={() => setDrawer(true)} aria-label="Menú"><Menu className="size-5" /></button>
        <div className="truncate text-sm font-semibold md:hidden">{brand.name}</div>
        <div className="ml-auto flex items-center gap-1.5">
          <Slot name="shell.quick" props={{}} />
          <NotificationBell />
        </div>
      </header>

      {/* Menú (teléfono) */}
      {drawer && (
        <div className="fixed inset-0 z-40 bg-ink/50 md:hidden" onClick={() => setDrawer(false)}>
          <div className="flex h-full w-[82%] max-w-[300px] flex-col bg-rail" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 items-center justify-between px-4">
              <span className="text-sm font-semibold text-white">{brand.name}</span>
              <button onClick={() => setDrawer(false)} className="text-rail-text" aria-label="Cerrar"><X className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2"><NavList items={items} onNavigate={() => setDrawer(false)} /></div>
            {UserBlock}
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-4 pt-5 pb-28 md:px-6 md:pb-10">
        <Outlet />
      </main>

      {/* Barra inferior (teléfono) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-panel pt-1.5 md:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileItems.length + 2}, minmax(0, 1fr))` }}>
        <BottomLink to={home} icon={Home} label="Inicio" />
        {mobileItems.map((i) => <BottomLink key={i.to} to={i.to} icon={i.icon} label={i.label} />)}
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-1 text-[11px] text-muted">
          <Menu className="size-5" />Más
        </button>
      </nav>
    </div>
  );
}

function BottomLink({ to, icon: Icon, label }: { to: string; icon: typeof Home; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-1 text-[11px]', isActive ? 'text-brand' : 'text-muted')}>
      <Icon className="size-5" /><span className="max-w-full truncate">{label}</span>
    </NavLink>
  );
}

import React, { useState } from 'react';
import {
  Activity,
  ShieldAlert,
  Stethoscope,
  MapPin,
  Cpu,
  BarChart3,
  Volume2,
  VolumeX,
  ChevronDown,
  LogOut,
  Users,
  Radio
} from 'lucide-react';
import { MICRO_ZONES } from '@shared/domainData';

const TABS = [
  { id: 'citizen', label: 'Citizen Guardian', icon: ShieldAlert },
  { id: 'doctor', label: 'Doctor Mesh', icon: Stethoscope },
  { id: 'command', label: '112 Command', icon: Radio },
  { id: 'models', label: 'Models & IoT Lab', icon: Cpu },
  { id: 'investor', label: 'Investor & Deck', icon: BarChart3 }
];

export default function StatusHeader({
  user,
  activeTab,
  onSelectTab,
  zoneId,
  onSelectZone,
  activeIncident,
  zoneRespondersCount,
  soundEnabled,
  onToggleSound,
  demoAccounts,
  onSwitchDemo,
  onLogout
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const roleColors = {
    citizen: 'bg-rose-50 text-rose-700 border-rose-200',
    responder: 'bg-blue-50 text-blue-700 border-blue-200',
    dispatcher: 'bg-teal-50 text-teal-700 border-teal-200'
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="h-16 flex items-center justify-between gap-3">
          {/* Brand */}
          <button
            type="button"
            onClick={() => onSelectTab('citizen')}
            className="flex items-center gap-2.5 text-left shrink-0"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-700 text-white flex items-center justify-center shadow-sm">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-slate-900">PulseGuard AI</span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded border border-slate-200">
                  v4.0
                </span>
              </div>
              <div className="text-[11px] text-slate-500 hidden md:block">
                Golden Hour Clinical &amp; Safety Mesh
              </div>
            </div>
          </button>

          {/* Primary Tabs */}
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/70">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const showBadge =
                activeIncident &&
                ((tab.id === 'doctor' && activeIncident.status === 'ACTIVE') ||
                  (tab.id === 'command' && ['ACTIVE', 'DISPATCHED', 'ON_SCENE'].includes(activeIncident.status)));
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-700' : 'text-slate-500'}`} />
                  <span>{tab.label}</span>
                  {showBadge && (
                    <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              <select
                value={zoneId}
                onChange={(e) => onSelectZone(e.target.value)}
                aria-label="Select Micro-Zone"
                className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
              >
                {Object.values(MICRO_ZONES).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.shortName}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={onToggleSound}
              title={soundEnabled ? 'Mute Clinical Audio' : 'Enable Clinical Audio'}
              className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-blue-700" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Account & Instant Persona Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
              >
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-semibold text-slate-900 leading-tight max-w-[125px] truncate">
                    {user.name}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase font-medium">
                    {user.nmcId || user.role}
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border ${roleColors[user.role] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                  {user.role}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-lg z-50 p-2 space-y-1">
                    <div className="px-3 py-2 border-b border-slate-100">
                      <div className="text-xs font-bold text-slate-900">{user.name}</div>
                      <div className="text-[11px] text-slate-500">{user.email}</div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
                        ECDH Key: {user.ecdhPubKey?.slice(0, 20)}...
                      </div>
                    </div>

                    <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Users className="w-3 h-3" /> Switch Authenticated Persona
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-0.5">
                      {demoAccounts.map((acc) => (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onSwitchDemo(acc.id);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors ${
                            acc.id === user.id ? 'bg-blue-50 text-blue-900 font-semibold' : 'hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{acc.name}</div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {acc.nmcId || acc.role} · {MICRO_ZONES[acc.microZone]?.shortName}
                            </div>
                          </div>
                          {acc.id === user.id && (
                            <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-xl transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out / Register New User
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-2.5 pt-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  isActive
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Status Ticker Bar */}
      <div
        className={`border-t text-xs py-2 px-4 sm:px-6 transition-colors ${
          activeIncident
            ? 'bg-rose-50 border-rose-200 text-rose-900'
            : 'bg-slate-50/90 border-slate-200/80 text-slate-600'
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                activeIncident ? 'bg-rose-600 animate-ping' : 'bg-emerald-500'
              }`}
            />
            {activeIncident ? (
              <span className="font-semibold">
                ACTIVE CODE BLUE ({activeIncident.id}) · {activeIncident.triggerType} via {activeIncident.transportMode} ·{' '}
                {activeIncident.assignedResponderName
                  ? `Assigned: ${activeIncident.assignedResponderName} (ETA ${Math.ceil((activeIncident.responderEtaSec || 150) / 60)}m)`
                  : `GeoHash ${activeIncident.geohash} Dispatching...`}
              </span>
            ) : (
              <span>
                <strong className="text-emerald-700 font-semibold">MESH STANDBY</strong> ·{' '}
                {MICRO_ZONES[zoneId]?.name} · {zoneRespondersCount} verified responders online · 0 active alarms
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[11px] font-medium tabular-nums">
            <span>Target ETA: <strong className="text-slate-900">3–5 min</strong></span>
            <span>RAM Buffer: <strong className="text-emerald-700">0B Disk (DPDP)</strong></span>
            <span>Standby VAD: <strong className="text-blue-700">&lt;0.5%/hr</strong></span>
          </div>
        </div>
      </div>
    </header>
  );
}

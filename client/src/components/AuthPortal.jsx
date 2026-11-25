import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Stethoscope,
  Radio,
  UserCheck,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Activity
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { MICRO_ZONES } from '@shared/domainData';

export default function AuthPortal({ onAuthenticated, demoAccounts = [] }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [role, setRole] = useState('citizen');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('ananya@pulseguard.in');
  const [password, setPassword] = useState('PulseGuard@2026');
  const [microZone, setMicroZone] = useState('aiims_delhi');
  const [bloodGroup, setBloodGroup] = useState('O+');
  const [safeWordLabel, setSafeWordLabel] = useState('RED LOTUS');
  const [nmcId, setNmcId] = useState('NMC-88412');
  const [nmcCheck, setNmcCheck] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode === 'register' && role === 'responder' && nmcId.trim().length >= 5) {
      const timer = setTimeout(async () => {
        try {
          const res = await apiRequest(`/responders/verify-nmc/${encodeURIComponent(nmcId.trim())}`);
          setNmcCheck(res);
        } catch (err) {
          setNmcCheck({ verified: false, error: err.message });
        }
      }, 280);
      return () => clearTimeout(timer);
    } else {
      setNmcCheck(null);
    }
  }, [mode, role, nmcId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : {
              name,
              email,
              password,
              role,
              microZone,
              bloodGroup,
              safeWordLabel,
              nmcId: role === 'responder' ? nmcId : undefined
            };
      const data = await apiRequest(endpoint, { method: 'POST', body });
      onAuthenticated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (userId) => {
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/auth/demo-login', {
        method: 'POST',
        body: { userId }
      });
      onAuthenticated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const highlightedAccounts = [
    demoAccounts.find((a) => a.id === 'usr-citizen-ananya'),
    demoAccounts.find((a) => a.id === 'usr-doc-sarah'),
    demoAccounts.find((a) => a.id === 'usr-bls-rohit'),
    demoAccounts.find((a) => a.id === 'usr-disp-112')
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#F6F8FB] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Product Thesis & 1-Click Verified Sandbox Personas */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-700 text-white flex items-center justify-center shadow-sm">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">PulseGuard AI</h1>
                <span className="badge-pill bg-blue-50 text-blue-700 border-blue-200">v4.0 Clinical Mesh</span>
              </div>
              <p className="text-sm text-slate-500">
                Golden Hour Emergency Response &amp; Autonomous Women Safety Infrastructure
              </p>
            </div>
          </div>

          <div className="clinical-card p-6 space-y-5">
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                Verified Architecture · Real Working Models
              </span>
              <h2 className="text-xl font-bold text-slate-900 leading-snug">
                Compressing India’s 20–45 min emergency latency down to 3–5 minutes
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                This live full-stack environment runs real on-device MFCC/DTW SafeWord DSP, PPG + RMSSD distress
                fusion, CAN-Bus + LSM6DSO crash physics, GeoHash micro-fencing, ECDH P-256 + AES-256-GCM encryption,
                and 52-byte Binary SMS fallback backed by SQLite &amp; Server-Sent Events.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="clinical-inset p-3.5">
                <div className="text-xs font-medium text-slate-500">Golden Hour Target</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">3–5 min</div>
                <div className="text-[11px] text-emerald-700 font-medium">60–70% OHCA survival window</div>
              </div>
              <div className="clinical-inset p-3.5">
                <div className="text-xs font-medium text-slate-500">Edge Audio Privacy</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">0 Bytes/Disk</div>
                <div className="text-[11px] text-blue-700 font-medium">2.5s Volatile RAM · 10ms hop</div>
              </div>
              <div className="clinical-inset p-3.5">
                <div className="text-xs font-medium text-slate-500">Zero-Signal Fallback</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">52B SMS</div>
                <div className="text-[11px] text-slate-600 font-medium">BLE 5.0 Coded PHY + GCM Tag</div>
              </div>
            </div>
          </div>

          {/* 1-Click Verified Sandbox Switcher */}
          <div className="clinical-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Instant Role Access (Seeded SQLite Identities)</h3>
                <p className="text-xs text-slate-500">
                  Launch directly into any role with a real JWT &amp; ECDH P-256 identity—or register a new account on the right.
                </p>
              </div>
              <span className="badge-pill bg-emerald-50 text-emerald-700 border-emerald-200">
                <Lock className="w-3 h-3" /> ECDH Ready
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {highlightedAccounts.map((acc) => {
                const icon =
                  acc.role === 'citizen' ? (
                    <ShieldCheck className="w-4 h-4 text-rose-600" />
                  ) : acc.role === 'responder' ? (
                    <Stethoscope className="w-4 h-4 text-blue-700" />
                  ) : (
                    <Radio className="w-4 h-4 text-teal-700" />
                  );
                const rolePill =
                  acc.role === 'citizen'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : acc.role === 'responder'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-teal-50 text-teal-700 border-teal-200';
                return (
                  <button
                    key={acc.id}
                    type="button"
                    disabled={loading}
                    onClick={() => handleDemoLogin(acc.id)}
                    className="group text-left p-3.5 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 transition-all flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {icon}
                        <span className="text-sm font-semibold text-slate-900 truncate">{acc.name}</span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">{acc.specialty || acc.email}</div>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border uppercase ${rolePill}`}>
                          {acc.nmcId || acc.role}
                        </span>
                        <span className="text-[11px] text-slate-400">{MICRO_ZONES[acc.microZone]?.shortName}</span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Real Sign In / Register Card */}
        <div className="lg:col-span-5">
          <div className="clinical-card p-6 sm:p-7">
            <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                  mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Account Role</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'citizen', label: 'Citizen' },
                        { id: 'responder', label: 'NMC / BLS' },
                        { id: 'dispatcher', label: '112 Desk' }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setRole(item.id)}
                          className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-colors ${
                            role === item.id
                              ? 'bg-blue-700 text-white border-blue-700'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={role === 'responder' ? 'Dr. Aarav Mehta, MD' : 'Riya Verma'}
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@pulseguard.in"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
                {mode === 'login' && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Demo credentials pre-filled for <span className="font-mono">ananya@pulseguard.in</span>
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Micro-Zone</label>
                      <select
                        value={microZone}
                        onChange={(e) => setMicroZone(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                      >
                        {Object.values(MICRO_ZONES).map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.shortName}
                          </option>
                        ))}
                      </select>
                    </div>
                    {role === 'citizen' ? (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Blood Group</label>
                        <select
                          value={bloodGroup}
                          onChange={(e) => setBloodGroup(e.target.value)}
                          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                        >
                          {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((bg) => (
                            <option key={bg} value={bg}>
                              {bg}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {role === 'responder' ? 'NMC / BLS Credential' : 'Desk Code'}
                        </label>
                        <input
                          type="text"
                          value={nmcId}
                          onChange={(e) => setNmcId(e.target.value)}
                          placeholder="NMC-88412 or BLS-AHA-1234"
                          className="w-full px-3 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                        />
                      </div>
                    )}
                  </div>

                  {role === 'citizen' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Voice SafeWord (On-Device Only)</label>
                      <input
                        type="text"
                        value={safeWordLabel}
                        onChange={(e) => setSafeWordLabel(e.target.value.toUpperCase())}
                        placeholder="RED LOTUS"
                        className="w-full px-3.5 py-2.5 text-sm font-mono uppercase bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  )}

                  {role === 'responder' && nmcCheck && (
                    <div
                      className={`p-3 rounded-xl text-xs border flex items-start gap-2 ${
                        nmcCheck.verified
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                    >
                      {nmcCheck.verified ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      )}
                      <div>
                        {nmcCheck.verified ? (
                          <>
                            <div className="font-semibold">{nmcCheck.tierLabel}</div>
                            <div className="text-[11px] opacity-90">
                              ABDM HPR: {nmcCheck.abdmHprId} · Scope: {nmcCheck.scope?.join(', ')}
                            </div>
                          </>
                        ) : (
                          <div>{nmcCheck.error}</div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <UserCheck className="w-4 h-4" />
                {loading
                  ? 'Authenticating...'
                  : mode === 'login'
                    ? 'Sign In with JWT & ECDH'
                    : 'Register & Provision ECDH Identity'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

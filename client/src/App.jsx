import React, { useEffect, useState, useCallback } from 'react';
import {
  apiRequest,
  getStoredToken,
  setStoredToken,
  openEventStream
} from './lib/api';
import { clinicalAudio } from './lib/sound';
import AuthPortal from './components/AuthPortal';
import StatusHeader from './components/StatusHeader';
import CitizenView from './components/CitizenView';
import DoctorMeshView from './components/DoctorMeshView';
import CommandView from './components/CommandView';
import ModelsLabView from './components/ModelsLabView';
import InvestorView from './components/InvestorView';

export default function App() {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(getStoredToken()));
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState('citizen');
  const [zoneId, setZoneId] = useState('aiims_delhi');
  const [incidents, setIncidents] = useState([]);
  const [zoneSnapshot, setZoneSnapshot] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    apiRequest('/auth/demo-accounts', { token: '' })
      .then((res) => setDemoAccounts(res.accounts || []))
      .catch(() => {});
  }, []);

  const refreshOperationalData = useCallback(async (authTok = token, targetZone = zoneId) => {
    if (!authTok) return;
    try {
      const [incRes, snapRes] = await Promise.all([
        apiRequest('/incidents', { token: authTok }),
        apiRequest(`/zones/${targetZone}/snapshot`, { token: authTok })
      ]);
      setIncidents(incRes.incidents || []);
      setZoneSnapshot(snapRes);
    } catch {
      // handled by auth check if token invalid
    }
  }, [token, zoneId]);

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      return;
    }
    setAuthLoading(true);
    apiRequest('/auth/me', { token })
      .then((res) => {
        setUser(res.user);
        const defaultTab =
          res.user.role === 'responder'
            ? 'doctor'
            : res.user.role === 'dispatcher'
              ? 'command'
              : 'citizen';
        setActiveTab(defaultTab);
        setZoneId(res.user.microZone || 'aiims_delhi');
        return refreshOperationalData(token, res.user.microZone || 'aiims_delhi');
      })
      .catch(() => {
        setStoredToken(null);
        setToken(null);
        setUser(null);
      })
      .finally(() => setAuthLoading(false));
  }, [token]);

  useEffect(() => {
    if (token && user) {
      refreshOperationalData(token, zoneId);
    }
  }, [zoneId]);

  // Real-time Server-Sent Events subscription
  useEffect(() => {
    if (!token || !user) return;
    return openEventStream(token, (eventName) => {
      if (['incident_created', 'incident_updated', 'pulsebox_updated', 'zone_controls_updated', 'responder_updated'].includes(eventName)) {
        refreshOperationalData(token, zoneId);
      }
    });
  }, [token, user, zoneId, refreshOperationalData]);

  const handleAuthenticated = ({ token: newTok, user: newUser }) => {
    setStoredToken(newTok);
    setToken(newTok);
    setUser(newUser);
    const defaultTab =
      newUser.role === 'responder'
        ? 'doctor'
        : newUser.role === 'dispatcher'
          ? 'command'
          : 'citizen';
    setActiveTab(defaultTab);
    setZoneId(newUser.microZone || 'aiims_delhi');
  };

  const handleSwitchDemo = async (userId) => {
    try {
      const data = await apiRequest('/auth/demo-login', {
        method: 'POST',
        body: { userId }
      });
      handleAuthenticated(data);
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setIncidents([]);
    setZoneSnapshot(null);
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    clinicalAudio.enabled = next;
    setSoundEnabled(next);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F8FB] text-slate-600 text-sm font-medium">
        Verifying JWT &amp; ECDH P-256 session...
      </div>
    );
  }

  if (!user) {
    return <AuthPortal onAuthenticated={handleAuthenticated} demoAccounts={demoAccounts} />;
  }

  const activeIncident = incidents.find(
    (inc) => inc.microZone === zoneId && ['ACTIVE', 'DISPATCHED', 'ON_SCENE'].includes(inc.status)
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F8FB]">
      <StatusHeader
        user={user}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        zoneId={zoneId}
        onSelectZone={setZoneId}
        activeIncident={activeIncident}
        zoneRespondersCount={zoneSnapshot?.responders?.length || 0}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        demoAccounts={demoAccounts}
        onSwitchDemo={handleSwitchDemo}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'citizen' && (
          <CitizenView
            user={user}
            zoneId={zoneId}
            incidents={incidents}
            zoneSnapshot={zoneSnapshot}
            onUserUpdated={setUser}
            onIncidentCreated={() => refreshOperationalData(token, zoneId)}
            onOpenDoctorTab={() => setActiveTab('doctor')}
          />
        )}

        {activeTab === 'doctor' && (
          <DoctorMeshView
            user={user}
            zoneId={zoneId}
            incidents={incidents}
            zoneSnapshot={zoneSnapshot}
            onUserUpdated={setUser}
            onRefreshData={() => refreshOperationalData(token, zoneId)}
          />
        )}

        {activeTab === 'command' && (
          <CommandView
            user={user}
            zoneId={zoneId}
            incidents={incidents}
            zoneSnapshot={zoneSnapshot}
            onRefreshData={() => refreshOperationalData(token, zoneId)}
          />
        )}

        {activeTab === 'models' && (
          <ModelsLabView
            user={user}
            zoneId={zoneId}
            zoneSnapshot={zoneSnapshot}
            onIncidentCreated={() => refreshOperationalData(token, zoneId)}
            onRefreshData={() => refreshOperationalData(token, zoneId)}
          />
        )}

        {activeTab === 'investor' && <InvestorView />}
      </main>
    </div>
  );
}

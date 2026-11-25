import React, { useState } from 'react';
import {
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Layers,
  IndianRupee
} from 'lucide-react';
import {
  FIVE_YEAR_FINANCIALS,
  UNIT_ECONOMICS,
  DECK_SLIDES
} from '@shared/domainData';

export default function InvestorView() {
  const [slideIdx, setSlideIdx] = useState(0);
  const [pupmInr, setPupmInr] = useState(20); // ₹15–₹25 PUPM range

  const scaleFactor = pupmInr / 20;
  const adjustedRows = FIVE_YEAR_FINANCIALS.map((row) => {
    const adjB2b = Number((row.b2b * scaleFactor).toFixed(2));
    const adjTotal = Number((adjB2b + row.b2g + row.hardware + row.subs).toFixed(2));
    const delta = adjB2b - row.b2b;
    const adjEbitda = Number((row.ebitda + delta * 0.82).toFixed(2));
    return {
      ...row,
      b2b: adjB2b,
      total: adjTotal,
      ebitda: adjEbitda,
      ebitdaMargin: Number(((adjEbitda / Math.max(0.1, adjTotal)) * 100).toFixed(1))
    };
  });

  const maxRev = Math.max(...adjustedRows.map((r) => r.total), 90);
  const slide = DECK_SLIDES[slideIdx];

  return (
    <div className="space-y-6">
      {/* Top Unit Economics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="clinical-card p-4">
          <div className="text-xs text-slate-500">Blended CAC</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">₹{UNIT_ECONOMICS.blendedCacInr}</div>
          <div className="text-[11px] text-slate-500">B2B insurer channel</div>
        </div>
        <div className="clinical-card p-4">
          <div className="text-xs text-slate-500">Customer LTV</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">₹{UNIT_ECONOMICS.customerLtvInr.toLocaleString('en-IN')}</div>
          <div className="text-[11px] text-slate-500">36-mo blended life</div>
        </div>
        <div className="clinical-card p-4">
          <div className="text-xs text-slate-500">LTV : CAC Ratio</div>
          <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">{UNIT_ECONOMICS.ltvCacRatio}</div>
          <div className="text-[11px] text-emerald-700">Verified exact ratio</div>
        </div>
        <div className="clinical-card p-4">
          <div className="text-xs text-slate-500">CAC Payback</div>
          <div className="text-xl font-bold text-blue-700 tabular-nums mt-0.5">{UNIT_ECONOMICS.paybackMonths} mo</div>
          <div className="text-[11px] text-slate-500">Software GM {UNIT_ECONOMICS.softwareGrossMarginPct}%</div>
        </div>
        <div className="clinical-card p-4 col-span-2 lg:col-span-1">
          <div className="text-xs text-slate-500">Seed Round Ask</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">₹{UNIT_ECONOMICS.seedAskInrCr.toFixed(2)} Cr</div>
          <div className="text-[11px] text-slate-500">${UNIT_ECONOMICS.seedAskUsdK}K · {UNIT_ECONOMICS.runwayMonths}-mo runway</div>
        </div>
      </div>

      {/* Reconciled 5-Year Trajectory & Sensitivity + Seed Allocation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 clinical-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-700" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">5-Year Reconciled Revenue &amp; EBITDA Model (₹ Cr)</h2>
                <p className="text-xs text-slate-500">
                  Adjust B2B Insurer PUPM pricing (₹15–₹25) to stress-test Y5 revenue &amp; operating leverage
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
              <span className="text-xs font-medium text-slate-600">B2B PUPM:</span>
              <input
                type="range"
                min={15}
                max={25}
                step={1}
                value={pupmInr}
                onChange={(e) => setPupmInr(Number(e.target.value))}
                className="w-24 accent-blue-700"
              />
              <span className="font-mono text-xs font-bold text-blue-700 tabular-nums">₹{pupmInr}/mo</span>
            </div>
          </div>

          {/* Crisp SVG Stacked Bar Chart */}
          <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3">
            <svg viewBox="0 0 640 240" className="w-full h-auto">
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = 200 - t * 165;
                return (
                  <g key={i}>
                    <line x1="48" y1={y} x2="615" y2={y} stroke="#E2E8F0" strokeWidth="1" />
                    <text x="42" y={y + 4} textAnchor="end" fontSize="10" fill="#64748B" fontFamily="monospace">
                      ₹{Math.round(maxRev * t)}
                    </text>
                  </g>
                );
              })}

              {adjustedRows.map((row, idx) => {
                const cx = 105 + idx * 112;
                const barW = 48;
                const scale = 165 / maxRev;
                const hB2b = row.b2b * scale;
                const hB2g = row.b2g * scale;
                const hHw = row.hardware * scale;
                const hSubs = row.subs * scale;

                let curY = 200;
                const rect = (h, fill) => {
                  curY -= h;
                  return <rect x={cx - barW / 2} y={curY} width={barW} height={Math.max(1, h)} fill={fill} rx="2" />;
                };

                return (
                  <g key={row.year}>
                    {rect(hB2b, '#1D4ED8')}
                    {rect(hB2g, '#0F766E')}
                    {rect(hHw, '#D97706')}
                    {rect(hSubs, '#64748B')}
                    <text x={cx} y={curY - 7} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0F172A">
                      ₹{row.total.toFixed(1)}Cr
                    </text>
                    <text x={cx} y={220} textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569">
                      {row.year}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-600 pt-1">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#1D4ED8]" /> B2B Insurance (47%)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#0F766E]" /> B2G 112 SaaS (20%)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#D97706]" /> IoT Hardware (20%)</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#64748B]" /> Family Shield (13%)</span>
            </div>
          </div>

          {/* Financial Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Stream (₹ Cr)</th>
                  {adjustedRows.map((r) => (
                    <th key={r.year} className="py-2 px-2 font-semibold">{r.year}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-700">B2B Insurance PUPM</td>
                  {adjustedRows.map((r) => <td key={r.year} className="py-2 px-2 font-mono">₹{r.b2b.toFixed(2)}</td>)}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-700">B2G Smart City 112</td>
                  {adjustedRows.map((r) => <td key={r.year} className="py-2 px-2 font-mono">₹{r.b2g.toFixed(2)}</td>)}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-700">B2C &amp; Fleet Hardware</td>
                  {adjustedRows.map((r) => <td key={r.year} className="py-2 px-2 font-mono">₹{r.hardware.toFixed(2)}</td>)}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-700">Family Shield Subs</td>
                  {adjustedRows.map((r) => <td key={r.year} className="py-2 px-2 font-mono">₹{r.subs.toFixed(2)}</td>)}
                </tr>
                <tr className="bg-slate-50 font-bold text-slate-900">
                  <td className="py-2 pr-3">Total Revenue</td>
                  {adjustedRows.map((r) => <td key={r.year} className="py-2 px-2 font-mono">₹{r.total.toFixed(2)}</td>)}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-semibold text-slate-700">EBITDA (₹ Cr / %)</td>
                  {adjustedRows.map((r) => (
                    <td key={r.year} className={`py-2 px-2 font-mono font-semibold ${r.ebitda >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {r.ebitda >= 0 ? `₹${r.ebitda.toFixed(2)}` : `-₹${Math.abs(r.ebitda).toFixed(2)}`} ({r.ebitdaMargin}%)
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Seed Round Capital Allocation */}
        <div className="lg:col-span-4 clinical-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-4 h-4 text-blue-700" />
            <h3 className="text-sm font-bold text-slate-900">Seed Capital Allocation (₹4.50 Cr)</h3>
          </div>
          <div className="space-y-3">
            {UNIT_ECONOMICS.capitalAllocation.map((item) => (
              <div key={item.label} className="clinical-inset p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                  <span>{item.label}</span>
                  <span className="font-mono text-blue-700">{item.pct}% (₹{item.amountCr.toFixed(2)}Cr)</span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-700 rounded-full" style={{ width: `${item.pct}%` }} />
                </div>
                <p className="text-[11px] text-slate-500">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Verified 16-Slide Executive Architecture Deck Browser */}
      <div className="clinical-card p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-700" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">Verified 16-Slide Executive &amp; Technical Deck</h3>
              <p className="text-xs text-slate-500">Slide {slide.id} of {DECK_SLIDES.length} · {slide.section}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={slideIdx === 0}
              onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <button
              type="button"
              disabled={slideIdx === DECK_SLIDES.length - 1}
              onClick={() => setSlideIdx((i) => Math.min(DECK_SLIDES.length - 1, i + 1))}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold flex items-center gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="clinical-inset p-6 space-y-4">
          <span className="badge-pill bg-blue-50 text-blue-700 border-blue-200">{slide.section}</span>
          <h4 className="text-xl font-bold text-slate-900">{slide.title}</h4>
          <p className="text-sm text-slate-600">{slide.subtitle}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {slide.kpis.map((kpi, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-3 text-xs font-medium text-slate-800">
                {kpi}
              </div>
            ))}
          </div>
          {slide.formula && (
            <div className="p-3 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs">
              {slide.formula}
            </div>
          )}
        </div>

        {/* Slide Index Pills */}
        <div className="flex flex-wrap gap-1.5">
          {DECK_SLIDES.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSlideIdx(idx)}
              className={`w-8 h-8 rounded-lg text-xs font-mono font-bold border transition-colors ${
                idx === slideIdx
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {String(s.id).padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Verified PulseGuard AI v4.0 Domain Dataset
// Strictly reconciled against the 16-Slide Verified Executive & Technical Architecture Deck

export const MICRO_ZONES = {
  aiims_delhi: {
    id: 'aiims_delhi',
    name: 'AIIMS Campus, New Delhi',
    shortName: 'AIIMS Delhi',
    phase: 'Phase 1 · Medical Hub',
    lat: 28.5672,
    lng: 77.2100,
    geohash: 'ttnfq7',
    density: '2,140 staff/km²',
    activeDoctors: 24,
    landmarks: {
      incidentDefault: 'AIIMS Outer Gate 4 Pedestrian Bay',
      corridor: 'Ring Road Trauma Corridor (12 Intersections)',
      hostel: 'Ansari Nagar Resident Doctors Hostel'
    },
    ambulanceStation: { lat: 28.5738, lng: 77.2165, label: 'CATS 108 Base · Safdarjung' }
  },
  pgimer_chandigarh: {
    id: 'pgimer_chandigarh',
    name: 'PGIMER Campus, Chandigarh',
    shortName: 'PGIMER Chandigarh',
    phase: 'Phase 1 · Medical Hub',
    lat: 30.7650,
    lng: 76.7750,
    geohash: 'ttqg3c',
    density: '1,890 staff/km²',
    activeDoctors: 19,
    landmarks: {
      incidentDefault: 'Sector 12 Trauma Entry Gate',
      corridor: 'Madhya Marg Signal Grid',
      hostel: 'Kairon Resident Hostel Block'
    },
    ambulanceStation: { lat: 30.7582, lng: 76.7830, label: '108 ALS Dispatch · Sector 16' }
  },
  hinjewadi_pune: {
    id: 'hinjewadi_pune',
    name: 'Hinjewadi IT Park, Pune',
    shortName: 'Hinjewadi Pune',
    phase: 'Phase 2 · Smart Cluster',
    lat: 18.5913,
    lng: 73.7389,
    geohash: 'tek9b2',
    density: '640 responders/km²',
    activeDoctors: 14,
    landmarks: {
      incidentDefault: 'Phase 2 Infotech Basement B2 Ramp',
      corridor: 'Wakad Expressway Junction',
      hostel: 'Quadron Clinic Hub & Warden Desk'
    },
    ambulanceStation: { lat: 18.5998, lng: 73.7495, label: '108 EMS Unit · Wakad Bridge' }
  },
  whitefield_blr: {
    id: 'whitefield_blr',
    name: 'Whitefield Tech Hub, Bengaluru',
    shortName: 'Whitefield BLR',
    phase: 'Phase 2 · Smart Cluster',
    lat: 12.9698,
    lng: 77.7500,
    geohash: 'tdr1z9',
    density: '710 responders/km²',
    activeDoctors: 16,
    landmarks: {
      incidentDefault: 'ITPL Main Gate Skywalk South',
      corridor: 'Outer Ring Traffic Corridor',
      hostel: 'Manipal Whitefield Resident Mesh'
    },
    ambulanceStation: { lat: 12.9765, lng: 77.7412, label: '108 Trauma Van · Hoodi Circle' }
  }
};

export const HARDWARE_SKUS = [
  {
    sku: 'SKU-01',
    id: 'obd_lite',
    name: 'PulseGuard OBD-II Lite',
    category: 'BLE-Tethered Vehicle Telematics',
    chipset: 'ESP32-S3 SoC · LSM6DSO 6-Axis IMU · SN65HVD230 CAN Transceiver',
    bomInr: 850,
    retailInr: 2499,
    grossMarginPct: 66.0,
    features: [
      'Direct OBD-II plug-and-play (CAN-bus speed Δv & DTC airbag crash confirmation)',
      'Relays encrypted crash frames via driver smartphone BLE 5.0 Coded PHY',
      'Motor insurer telematics safety scoring (harsh braking & impact logs)',
      'Automotive-grade LSM6DSO IMU replaces hobbyist MPU-6050'
    ]
  },
  {
    sku: 'SKU-02',
    id: 'obd_pro',
    name: 'PulseGuard OBD-II Pro (Standalone)',
    category: 'Autonomous Cellular eCall Dongle',
    chipset: 'ESP32-S3 · Quectel BG95 LTE Cat-M1/2G + eSIM · GNSS · LSM6DSO',
    bomInr: 1450,
    retailInr: 3999,
    grossMarginPct: 63.7,
    features: [
      'Independent cellular + GNSS telemetry even if smartphone is damaged or lost',
      'Dual-factor crash trigger: G_peak > 10G + CAN Δv ≥ 25 km/h or rollover',
      'Fleet & highway commercial insurance integration with zero driver setup',
      'Quectel BG95 Cat-M1/2G modem + eSIM accurately budgeted in BOM'
    ]
  },
  {
    sku: 'SKU-03',
    id: 'pulsebox',
    name: 'PulseBox Smart Triage Cabinet',
    category: 'Gated Community & Senior Care Hub',
    chipset: 'Medical-Grade ABS · Tactile SOS · 4G/Wi-Fi Intercom · Load Sensors',
    bomInr: 1800,
    retailInr: 4999,
    grossMarginPct: 64.0,
    features: [
      'Wall-mounted 24/7 two-way audio link directly to PulseGuard Triage Desk',
      'Automated optical/weight depletion alerts for trauma & first-aid kits',
      'Universal AED-ready alarmed solenoid bay (clinical AED leased via hospital partner)',
      'Acts as fixed indoor BLE 5.0 Coded PHY relay gateway for basements'
    ]
  }
];

export const FIVE_YEAR_FINANCIALS = [
  { year: 'Year 1', b2b: 0.40, b2g: 0.30, hardware: 0.35, subs: 0.15, total: 1.20, ebitda: -0.45, ebitdaMargin: -37.5 },
  { year: 'Year 2', b2b: 2.80, b2g: 1.50, hardware: 2.10, subs: 0.80, total: 7.20, ebitda: 0.60, ebitdaMargin: 8.3 },
  { year: 'Year 3', b2b: 12.50, b2g: 5.00, hardware: 7.80, subs: 3.20, total: 28.50, ebitda: 7.00, ebitdaMargin: 24.6 },
  { year: 'Year 4', b2b: 28.00, b2g: 12.00, hardware: 14.50, subs: 7.00, total: 61.50, ebitda: 20.00, ebitdaMargin: 32.5 },
  { year: 'Year 5', b2b: 42.00, b2g: 18.00, hardware: 17.50, subs: 11.00, total: 88.50, ebitda: 31.00, ebitdaMargin: 35.0 }
];

export const UNIT_ECONOMICS = {
  blendedCacInr: 140,
  customerLtvInr: 1680,
  ltvCacRatio: '12 : 1',
  paybackMonths: 3.8,
  softwareGrossMarginPct: 82,
  seedAskInrCr: 4.50,
  seedAskUsdK: 540,
  runwayMonths: 18,
  capitalAllocation: [
    { label: 'Edge AI, DSP & Hardware Certification', amountCr: 1.80, pct: 40, detail: 'LiteRT INT8 voice/stress models, AIS-140/ARAI OBD-II certification & pilot tooling' },
    { label: 'Micro-Zone GTM & Responder Onboarding', amountCr: 1.35, pct: 30, detail: 'AIIMS Delhi, PGIMER & Manipal deployments + ABDM HPR/NMR verification pipeline' },
    { label: 'Indemnity Pool, DPDP & Security Audits', amountCr: 0.90, pct: 20, detail: '₹10L/incident responder indemnity underwriting, DPDP Act & ISO 27001 readiness' },
    { label: 'Operations & Working Capital', amountCr: 0.45, pct: 10, detail: '24/7 clinical triage desk operations & 18-month runway buffer' }
  ]
};

export const DECK_SLIDES = [
  {
    id: 1,
    section: 'OVERVIEW',
    title: 'PulseGuard AI · Golden Hour Response & Autonomous Safety Mesh',
    subtitle: 'Compressing India’s 20–45 minute emergency latency down to 3–5 minutes via On-Device Edge AI, a Hyper-Local NMC Doctor Mesh, and Offline BLE 5.0 Connectivity.',
    kpis: ['3–5 min Target Golden Hour Arrival', '100% Volatile RAM Edge Privacy', 'Zero-Touch Voice & Biometric SOS'],
    formula: 'Verified Telemetry: Smartwatch PPG + Gravity-Free IMU · EMS 108 Bridge + PulseBox AED Bay (No Unbudgeted UAV Claims)'
  },
  {
    id: 2,
    section: '01 · PROBLEM ANALYSIS',
    title: 'The Golden Hour Collapse & Manual SOS Failure',
    subtitle: 'Why centralized ambulances and tap-to-alert apps fail when seconds decide survival.',
    kpis: ['172,890+ Annual India road deaths (MoRTH 2023)', '7–10% / min OHCA survival loss without CPR (AHA)', '60–70% survival window at 3–5 min vs <2% at 20–45 min'],
    formula: 'Law Commission Report 201 & WHO: Up to 50% of trauma deaths are preventable with timely stabilization.'
  },
  {
    id: 3,
    section: '02 · CORE SOLUTION',
    title: 'Dual-Pillar 3-to-5 Minute Response Platform',
    subtitle: 'Uber-style clinical dispatch paired with zero-touch autonomous distress detection.',
    kpis: ['Pillar 01: GeoHash Micro-Fencing (1–2 km NMC Doctors)', 'Pillar 02: <45ms Hands-Free Edge SafeWord & PPG/HRV', 'Section 134A MV Act + ₹10L/incident Indemnity'],
    formula: 'Just as ride-hailing collapsed cab wait times to 3 minutes via hyper-local supply matching, PulseGuard collapses life-saving response.'
  },
  {
    id: 4,
    section: '03 · SYSTEM ARCHITECTURE',
    title: '4-Tier Edge-to-Mesh Signal Architecture',
    subtitle: 'Deterministic end-to-end orchestration with zero-cloud audio exposure and offline failover.',
    kpis: ['Tier 01: 2.5s Ring Buffer, 100Hz IMU, PPG, CAN-Bus', 'Tier 02: <1.5 MB LiteRT INT8 + <45ms Inference', 'Tier 03: TLS 1.3 WS | BLE 5.0 Coded PHY | 52B SMS', 'Tier 04: GeoHash Match & Push <1.8s End-to-End'],
    formula: 'Ingest: 25ms | Edge NPU: <45ms | E2EE Uplink: ~350ms | GeoHash Match & Push: <1.3s'
  },
  {
    id: 5,
    section: '04 · EDGE AUDIO DSP',
    title: 'On-Device Voice SafeWord & MFCC Pipeline',
    subtitle: 'Privacy-preserving keyword spotting running in <1.5 MB INT8 LiteRT with <45ms latency.',
    kpis: ['2.5s Volatile RAM @ 16kHz', '25ms Frame · 10ms Hop · Overwrites every 10ms', '40-Band Mel Filterbank -> 13 MFCC -> INT8 DS-CNN', '<0.5%/hr Standby Draw via Hardware VAD Gating'],
    formula: 'MFCC[c] = DCT( log( MelFilterBank( |STFT(x[n])|² ) ) )'
  },
  {
    id: 6,
    section: '05 · SENSOR FUSION',
    title: 'PPG Distress Fusion & CAN-Bus Crash Physics',
    subtitle: 'Gravity-compensated biometrics and dual-factor automotive collision detection.',
    kpis: ['15s rolling PPG + RMSSD collapse (>40% drop)', '5-sec silent haptic cancelable countdown (<0.2% FP)', 'Pothole rejection via CAN Δv ≥ 25 km/h (<150ms)', 'Non-rollover head-on/T-bone + rollover θ>60°/ω>90°/s'],
    formula: 'Panic = (ΔHR ≥ +35 BPM ≥15s) ∧ (RMSSD drop > 40%) ∧ (|a_total−g| < 0.15g)  |  Crash = (G_peak > 10G ∧ CAN Δv ≥ 25km/h) ∨ (θ>60° ∨ ω>90°/s)'
  },
  {
    id: 7,
    section: '06 · RESILIENT CONNECTIVITY',
    title: 'BLE 5.0 Coded PHY Mesh & 52-Byte Encrypted SMS',
    subtitle: 'Surviving basements, highways, and network congestion without active mobile data.',
    kpis: ['BLE Coded PHY: 30m indoor / 100m+ outdoor, max 4 hops', 'Zero-knowledge relay: opaque AES-256-GCM packets', '52B Binary SMS = 72 Base64 chars inside 140B GSM-7', '88 Bytes free headroom inside single priority SMS'],
    formula: '8B GPS + 4B TS + 8B ID + 4B Vitals (24B) + 12B IV + 16B GCM Tag = 52B -> 72 Base64 chars'
  },
  {
    id: 8,
    section: '07 · HARDWARE ECOSYSTEM',
    title: 'OBD-II Telematics Suite & PulseBox Triage Hub',
    subtitle: 'Right-sized IoT hardware tiers with 64–66% blended gross margins and honest BOM accounting.',
    kpis: ['OBD-II Lite: BOM ₹850 · Retail ₹2,499 · 66.0% GM', 'OBD-II Pro (Cat-M1/eSIM): BOM ₹1,450 · Retail ₹3,999 · 63.7% GM', 'PulseBox Cabinet: BOM ₹1,800 · Retail ₹4,999 · 64.0% GM'],
    formula: 'Upgraded to automotive LSM6DSO IMU & SN65HVD230 CAN; PulseBox AED leased separately via hospital partners.'
  },
  {
    id: 9,
    section: '08 · GO-TO-MARKET',
    title: 'Solving Cold-Start via Hyper-Dense Micro-Zones',
    subtitle: 'Concentrating verified responder liquidity inside medical campuses before city-wide scale.',
    kpis: ['Phase 1 (M0–6): AIIMS Delhi, PGIMER, Manipal (2,000+ staff/km²)', 'Phase 2 (M6–12): Hinjewadi, Whitefield, Vijay Nagar', 'Tier A: NMC NMR + ABDM HPR Licensed Doctors/Nurses/CRMI', 'Tier B: Final-year MBBS & wardens strictly BLS/AED scope'],
    formula: '500+ Verified Responders · <3 Min Campus ETA · 24/7 Shift Liquidity from Day 1'
  },
  {
    id: 10,
    section: '09 · SUPPLY SUSTAINABILITY',
    title: 'Statutory Good Samaritan Shield & Responder Incentives',
    subtitle: 'Eliminating legal hesitation while rewarding verified life-saving interventions.',
    kpis: ['Section 134A MV Act (2019) & MoRTH 2020 Rules', '₹10 Lakh ($12,000) per-incident professional indemnity', 'Day-1 Live: ₹500–₹1,200 stipend (2x 11PM–6AM surge)', 'Phase 1–2: CME Credits · Target MoU: 5–15% Prop Tax Rebate'],
    formula: 'SaveLIFE Foundation v. Union of India statutory immunity + timestamped care audit logs'
  },
  {
    id: 11,
    section: '10 · MONETIZATION',
    title: 'Diversified 4-Tier Revenue Model (B2B · B2G · B2C)',
    subtitle: 'High-margin enterprise recurring software anchored by insurer claim-reduction economics.',
    kpis: ['47% Y5: B2B Insurance PUPM ₹15–₹25 (₹42.0 Cr)', '20% Y5: B2G Smart City & 112 SaaS ₹1.5–4 Cr/city (₹18.0 Cr)', '20% Y5: IoT Hardware Sales ~65% GM (₹17.5 Cr)', '13% Y5: Family Shield ₹199/mo for 4 members (₹11.0 Cr)'],
    formula: '20–30% severe trauma claim payout reduction drives recurring B2B insurer PUPM adoption'
  },
  {
    id: 12,
    section: '11 · FINANCIALS',
    title: '5-Year Reconciled Revenue & Operating Leverage',
    subtitle: 'Scaling from ₹1.20 Cr pilot revenue to ₹88.50 Cr with disciplined 35.0% Year 5 EBITDA.',
    kpis: ['Y1 ₹1.20Cr (-37.5% EBITDA) -> Y2 ₹7.20Cr (+8.3%)', 'Y3 ₹28.50Cr (+24.6%) -> Y4 ₹61.50Cr (+32.5%) -> Y5 ₹88.50Cr (+35.0%)', 'CAC ₹140 · LTV ₹1,680 · 12 : 1 LTV:CAC', 'Payback 3.8 months · Software GM 82%'],
    formula: 'Operational breakeven in Year 2 (+₹0.60 Cr EBITDA) scaling to ₹31.00 Cr EBITDA in Year 5'
  },
  {
    id: 13,
    section: '12 · COMPETITIVE MOAT',
    title: 'Market Landscape & Defensible Technical Moat',
    subtitle: 'Why wearables, 108 ambulances, and legacy panic apps cannot close India’s Golden Hour gap.',
    kpis: ['3–5 min target arrival vs 20–45 min Govt 108/112', 'On-site NMC clinical stabilization before ambulance', 'Moat 01: <1.5 MB Edge AI + BLE Coded PHY IP', 'Moat 02–03: NMC Clinical Liquidity + 112/Insurer Lock-in'],
    formula: 'Only full-stack mesh delivering hands-free panic/crash trigger + offline multi-hop + verified clinical dispatch'
  },
  {
    id: 14,
    section: '13 · SECURITY & COMPLIANCE',
    title: 'Privacy-by-Design & Indian Regulatory Readiness',
    subtitle: 'Volatile-RAM audio isolation, ECDH/AES-256-GCM encryption, and DPDP Act 2023 alignment.',
    kpis: ['2.5s Volatile RAM ring buffer -> 10ms overwrite -> 0B flash/cloud', 'Ephemeral ECDH P-256 + AES-256-GCM auto-revoking on closure', 'DPDP Act 2023 + ABDM Health Data Policy & FHIR', 'Seed Roadmap: ISO/IEC 27001, SOC 2 Type II & CERT-In VAPT'],
    formula: 'ECDH P-256 Session Key -> AES-256-GCM Scoped Envelope -> Cryptographic Shredding on Incident Close'
  },
  {
    id: 15,
    section: '14 · EXECUTION ROADMAP',
    title: 'Synchronized 4-Phase Rollout Plan (Months 0–60)',
    subtitle: 'Milestones aligned quarter-by-quarter with responder liquidity and financial targets.',
    kpis: ['M0–6: <1.5MB LiteRT SDK, AIIMS/PGIMER pilots, 500 responders', 'M6–12: ARAI/AIS-140 OBD-II launch, 25K users, 112 pilot', 'M12–36: Y2 breakeven, 3 State 112 SaaS, 25K staff, ISO 27001', 'M36–60: 10M ecosystem users, NH corridors, Indonesia & Vietnam'],
    formula: 'Phase-gated execution tying clinical density directly to B2B PUPM & B2G 112 revenue milestones'
  },
  {
    id: 16,
    section: '15 · THE ASK',
    title: 'Seed Round: ₹4.5 Cr ($540K) for 18-Month Scale',
    subtitle: 'Funding Edge AI & hardware certification, 3 medical campus launches, and B2B insurer conversion.',
    kpis: ['40% (₹1.80 Cr) Edge AI, DSP & AIS-140/ARAI Cert', '30% (₹1.35 Cr) AIIMS/PGIMER/Manipal GTM & NMR/HPR', '20% (₹0.90 Cr) ₹10L Indemnity Pool & DPDP/ISO Audits', '10% (₹0.45 Cr) 24/7 Triage Desk & Working Capital'],
    formula: 'Series A Readiness (18m): 1,500+ Verified Doctors · 2+ Insurer PUPM Contracts · ₹7.2 Cr Run-Rate (+EBITDA)'
  }
];

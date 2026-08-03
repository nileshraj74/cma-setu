
// ============================================================================
// CMA CALCULATION ENGINE — faithful JS port of my_cma.xlsx formulas
// Sheets replicated: DEPR_SCHEDULE, LOAN_SCHEDULE, ANN1..ANN9
// All figures in Rupees Lacs. Historical years = direct passthrough of actual
// figures (exactly like columns B/C/D in the original workbook). Projected
// years = computed from norms/assumptions (exactly like columns E..N).
// ============================================================================

const ASSET_BLOCKS = [
  { key: 'land',       label: 'Land (No Depreciation)',   itRate: 0,     slmRate: 0,      life: 0,  hasCapex: false },
  { key: 'buildings',  label: 'Buildings / Civil Works',   itRate: 0.10,  slmRate: 0.0334, life: 30, hasCapex: true  },
  { key: 'pm',         label: 'Plant & Machinery',         itRate: 0.15,  slmRate: 0.0528, life: 15, hasCapex: true  },
  { key: 'vehicles',   label: 'Vehicles',                  itRate: 0.15,  slmRate: 0.1131, life: 8,  hasCapex: true  },
  { key: 'computers',  label: 'Computers / IT Equipment',  itRate: 0.60,  slmRate: 0.1621, life: 3,  hasCapex: true  },
  { key: 'furniture',  label: 'Furniture & Fixtures',      itRate: 0.10,  slmRate: 0.0633, life: 10, hasCapex: true  },
  { key: 'other',      label: 'Other Fixed Assets',        itRate: 0.15,  slmRate: 0.0475, life: 20, hasCapex: true  },
];

function fyLabel(startYear, offset) {
  const y = startYear + offset;
  const yy = (y + 1) % 100;
  return `${y}-${String(yy).padStart(2, '0')}`;
}

function buildYearMeta(state) {
  const total = state.histCount + state.projCount;
  const labels = Array.from({ length: total }, (_, i) => fyLabel(state.fyStartYear, i));
  const types = labels.map((_, i) => {
    if (i < state.histCount - 1) return 'Audited';
    if (i === state.histCount - 1) return 'Provisional';
    return 'Projected';
  });
  return { total, labels, types };
}

function computeDepr(state) {
  const years = state.projCount;
  const byBlock = {};
  for (const b of ASSET_BLOCKS) {
    const a = state.assets[b.key] || { grossCost: 0, accumDepr: 0 };
    const opening = [], additions = [], wdvDepr = [], closing = [], slmDepr = [];
    for (let p = 0; p < years; p++) {
      const op = p === 0 ? (a.grossCost - a.accumDepr) : closing[p - 1];
      const add = b.hasCapex ? (state.newCapex[b.key]?.[p] || 0) : 0;
      const wd = (op + add * 0.5) * b.itRate;
      const cl = op + add - wd;
      const sl = a.grossCost * b.slmRate + add * b.slmRate;
      opening.push(op); additions.push(add); wdvDepr.push(wd); closing.push(cl); slmDepr.push(sl);
    }
    byBlock[b.key] = { opening, additions, wdvDepr, closing, slmDepr };
  }
  const totals = { wdv: [], slm: [], netBlock: [] };
  for (let p = 0; p < years; p++) {
    totals.wdv[p] = ASSET_BLOCKS.reduce((s, b) => s + byBlock[b.key].wdvDepr[p], 0);
    totals.slm[p] = ASSET_BLOCKS.reduce((s, b) => s + byBlock[b.key].slmDepr[p], 0);
    totals.netBlock[p] = ASSET_BLOCKS.reduce((s, b) => s + byBlock[b.key].closing[p], 0);
  }
  return { byBlock, totals };
}

function amortizeEMI(principal, monthlyRate, nMonths) {
  if (principal <= 0 || nMonths <= 0) return 0;
  if (monthlyRate === 0) return principal / nMonths;
  const f = Math.pow(1 + monthlyRate, nMonths);
  return (principal * monthlyRate * f) / (f - 1);
}

function computeLoans(state) {
  const years = state.projCount;
  const totalMonths = years * 12;
  const perLoan = state.loans.map((L) => {
    const monthlyRate = (Number(L.rate) || 0) / 12;
    const moratMonths = Math.max(0, Number(L.moratoriumMonths) || 0);
    const repayMonths = Math.max(1, Number(L.repaymentMonths) || 1);
    const tranches = (L.tranches || []).map(t => ({ monthOffset: Math.max(0, Number(t.monthOffset) || 0), amount: Number(t.amount) || 0 }));

    const mOpening = [], mInterest = [], mPrincipal = [], mClosing = [];
    let outstanding = Number(L.existingAmt) || 0, emiAmount = null;
    for (let m = 0; m < totalMonths; m++) {
      const openingBal = outstanding;
      const disb = tranches.filter(t => t.monthOffset === m).reduce((s, t) => s + t.amount, 0);
      outstanding += disb;
      let interest, principal;
      if (m < moratMonths) {
        interest = outstanding * monthlyRate;
        principal = 0;
      } else {
        if (emiAmount === null) emiAmount = amortizeEMI(outstanding, monthlyRate, repayMonths);
        interest = outstanding * monthlyRate;
        principal = outstanding <= 0 ? 0 : Math.min(outstanding, Math.max(0, emiAmount - interest));
      }
      outstanding = Math.max(0, outstanding - principal);
      mOpening.push(openingBal); mInterest.push(interest); mPrincipal.push(principal); mClosing.push(outstanding);
    }
    // Aggregate monthly detail into fiscal-year summaries (what Reports actually displays)
    const opening = [], interest = [], principal = [], closing = [];
    for (let y = 0; y < years; y++) {
      const s = y * 12, e = s + 11;
      opening.push(mOpening[s]);
      interest.push(mInterest.slice(s, e + 1).reduce((a, b) => a + b, 0));
      principal.push(mPrincipal.slice(s, e + 1).reduce((a, b) => a + b, 0));
      closing.push(mClosing[e]);
    }
    return { opening, interest, principal, closing, monthly: { opening: mOpening, interest: mInterest, principal: mPrincipal, closing: mClosing } };
  });
  const totals = { interest: [], principal: [], outstanding: [], debtService: [] };
  for (let p = 0; p < years; p++) {
    totals.interest[p] = perLoan.reduce((s, L) => s + L.interest[p], 0);
    totals.principal[p] = perLoan.reduce((s, L) => s + L.principal[p], 0);
    totals.outstanding[p] = perLoan.reduce((s, L) => s + L.closing[p], 0);
    totals.debtService[p] = totals.interest[p] + totals.principal[p];
  }
  return { perLoan, totals };
}

function computeAll(state) {
  const { total, labels, types } = buildYearMeta(state);
  const hist = state.histCount, proj = state.projCount;
  const depr = computeDepr(state);
  const loan = computeLoans(state);

  // ---- ANN2 Phase 1: revenue & cost side through EBIT (all years) ----
  const ann2 = Array.from({ length: total }, () => ({}));
  for (let h = 0; h < hist; h++) {
    const P = state.histPL;
    const grossSales = P.salesGross[h] || 0, gst = P.gst[h] || 0;
    const netSales = grossSales - gst;
    const otherOpIncome = P.otherOpIncome[h] || 0, miscIncome = P.miscIncome[h] || 0;
    const totalIncome = netSales + otherOpIncome + miscIncome;
    const rmConsumed = (P.rmOpening[h] || 0) + (P.rmPurchase[h] || 0) - (P.rmClosing[h] || 0);
    const directLabour = P.directLabour[h] || 0, powerFuel = P.powerFuel[h] || 0, otherMfg = P.otherMfg[h] || 0;
    const openingWIP = P.openingWIP[h] || 0, closingWIP = P.closingWIP[h] || 0;
    const totalCostMfg = rmConsumed + directLabour + powerFuel + otherMfg + openingWIP - closingWIP;
    const openingFG = P.openingFG[h] || 0, closingFG = P.closingFG[h] || 0;
    const cogs = totalCostMfg + openingFG - closingFG;
    const grossProfit = netSales - cogs;
    const adminSelling = P.adminSelling[h] || 0;
    const ebitda = grossProfit - adminSelling;
    const deprAmt = P.deprBooks[h] || 0;
    const ebit = ebitda - deprAmt;
    const interestTL = P.interestTL[h] || 0, interestWC = P.interestWC[h] || 0;
    const totalFinCharges = interestTL + interestWC;
    const pbt = ebit - totalFinCharges;
    const tax = P.incomeTax[h] || 0;
    const pat = pbt - tax;
    const nca = pat + deprAmt;
    Object.assign(ann2[h], { grossSales, gst, netSales, otherOpIncome, miscIncome, totalIncome, rmConsumed, directLabour, powerFuel, otherMfg, openingWIP, closingWIP, totalCostMfg, openingFG, closingFG, cogs, grossProfit, adminSelling, ebitda, depr: deprAmt, ebit, interestTL, interestWC, totalFinCharges, pbt, tax, pat, nca });
  }
  for (let p = 0; p < proj; p++) {
    const idx = hist + p;
    const R = state.revenueProj, K = state.costAssumptions;
    const capUtil = R.capacityUtil[p] || 0;
    const priceGrown = (Number(R.sellingPriceY1) || 0) * Math.pow(1 + (Number(R.priceGrowth) || 0), p);
    const capacityBased = (Number(R.installedCapacity) || 0) * capUtil * priceGrown;
    const override = R.salesOverride[p] || 0;
    const netSales = override > 0 ? override : capacityBased;
    const grossSales = netSales, gst = 0;
    const otherOpIncome = R.otherOpIncomeProj[p] || 0, miscIncome = R.miscIncomeProj[p] || 0;
    const totalIncome = netSales + otherOpIncome + miscIncome;
    const rmConsumed = netSales * (Number(K.rmPct) || 0);
    const directLabour = (Number(K.laborY1) || 0) * Math.pow(1 + (Number(K.laborGrowth) || 0), p);
    const powerFuel = netSales * (Number(K.powerFuelPct) || 0);
    const otherMfg = netSales * (Number(K.otherMfgPct) || 0);
    const openingWIP = p === 0 ? (state.histPL.closingWIP[hist - 1] || 0) : ann2[idx - 1].closingWIP;
    const closingWIP = rmConsumed * (Number(K.wipPct) || 0);
    const totalCostMfg = rmConsumed + directLabour + powerFuel + otherMfg + openingWIP - closingWIP;
    const openingFG = p === 0 ? (state.histPL.closingFG[hist - 1] || 0) : ann2[idx - 1].closingFG;
    const closingFG = totalCostMfg * (Number(K.fgPct) || 0);
    const cogs = totalCostMfg + openingFG - closingFG;
    const grossProfit = netSales - cogs;
    const adminSelling = netSales * (Number(K.adminPct) || 0);
    const ebitda = grossProfit - adminSelling;
    const deprAmt = depr.totals.wdv[p];
    const ebit = ebitda - deprAmt;
    const interestTL = loan.totals.interest[p];
    Object.assign(ann2[idx], { grossSales, gst, netSales, otherOpIncome, miscIncome, totalIncome, rmConsumed, directLabour, powerFuel, otherMfg, openingWIP, closingWIP, totalCostMfg, openingFG, closingFG, cogs, grossProfit, adminSelling, ebitda, depr: deprAmt, ebit, interestTL, _pending: true });
  }

  // ---- ANN3: WC assessment (norm-based, all years use ANN2 rm/netSales/admin) ----
  const ann3 = Array.from({ length: total }, () => ({}));
  const N = state.wcNorms;
  for (let i = 0; i < total; i++) {
    const A = ann2[i];
    const rmStock = A.rmConsumed * (Number(N.rmMonths) || 0) / 12;
    const wipStock = A.rmConsumed * (Number(N.wipMonths) || 0) / 12;
    const fgStock = A.cogs * (Number(N.fgMonths) || 0) / 12;
    const totalStocks = rmStock + wipStock + fgStock;
    const receivables = A.netSales * (Number(N.debtorsMonths) || 0) / 12;
    const cashBank = A.totalIncome * (Number(N.cashMonths) || 0) / 12;
    const otherCA = 0;
    const gwc = totalStocks + receivables + cashBank + otherCA;
    const creditors = A.rmConsumed * (Number(N.creditorsMonths) || 0) / 12;
    const otherCL = A.adminSelling * (Number(N.oclMonths) || 0) / 12;
    const tlInstalments = i >= hist ? loan.totals.principal[i - hist] : 0;
    const totalCL = creditors + otherCL + tlInstalments;
    const nwc = gwc - totalCL;
    const mpbf1 = 0.75 * nwc;
    const mpbf2 = 0.75 * gwc - totalCL;
    const turnoverMethod = 0.2 * A.grossSales;
    const dpStocks = 0.75 * totalStocks - creditors;
    const dpReceivables = 0.75 * receivables;
    const dpTotal = dpStocks + dpReceivables;
    const bankFinance = (Number(N.wcLimitY1) || 0) > 0 ? Number(N.wcLimitY1) : mpbf1;
    const margin = gwc - bankFinance;
    const currentRatioIncl = totalCL ? gwc / totalCL : 0;
    const currentRatioExcl = (totalCL - tlInstalments) ? gwc / (totalCL - tlInstalments) : 0;
    Object.assign(ann3[i], { rmStock, wipStock, fgStock, totalStocks, receivables, cashBank, otherCA, gwc, creditors, otherCL, tlInstalments, totalCL, nwc, mpbf1, mpbf2, turnoverMethod, dpStocks, dpReceivables, dpTotal, bankFinance, margin, currentRatioIncl, currentRatioExcl });
  }

  // ---- ANN2 Phase 2: finish interestWC / PBT / tax / PAT / NCA for projected years ----
  for (let p = 0; p < proj; p++) {
    const idx = hist + p;
    const A = ann2[idx];
    const interestWC = ann3[idx].bankFinance * (Number(state.wcNorms.wcRate) || 0);
    const totalFinCharges = A.interestTL + interestWC;
    const pbt = A.ebit - totalFinCharges;
    const tax = Math.max(0, pbt * (Number(state.costAssumptions.taxRate) || 0));
    const pat = pbt - tax;
    const nca = pat + A.depr;
    Object.assign(A, { interestWC, totalFinCharges, pbt, tax, pat, nca });
    delete A._pending;
  }

  // ---- ANN4A: actual WC position from historical BS (historical years only) ----
  const ann4a = [];
  for (let h = 0; h < hist; h++) {
    const B = state.histBS, A = ann2[h];
    const stocks = B.inventories[h] || 0;
    const rmMonthsImplied = A.rmConsumed ? (stocks / A.rmConsumed) * 12 : 0;
    const receivables = B.receivables[h] || 0;
    const debtorMonthsImplied = A.netSales ? (receivables / A.netSales) * 12 : 0;
    const cashBank = B.cashBank[h] || 0;
    const otherCA = (B.stLoansAdv[h] || 0) + (B.otherCA[h] || 0);
    const gwc = stocks + receivables + cashBank + otherCA;
    const creditors = B.tradePayables[h] || 0;
    const creditorMonthsImplied = A.rmConsumed ? (creditors / A.rmConsumed) * 12 : 0;
    const otherCL = B.otherCL[h] || 0;
    const tlInstalments = 0;
    const totalCL = creditors + otherCL + tlInstalments;
    const nwc = gwc - totalCL;
    const bankFinance = B.wcBorrowings[h] || 0;
    const currentRatio = totalCL ? gwc / totalCL : 0;
    const mpbf1 = 0.75 * nwc;
    ann4a.push({ stocks, rmMonthsImplied, receivables, debtorMonthsImplied, cashBank, otherCA, gwc, creditors, creditorMonthsImplied, otherCL, totalCL, nwc, bankFinance, currentRatio, mpbf1 });
  }

  // ---- ANN5: Balance Sheet (historical = direct passthrough, projected = computed + plug) ----
  const ann5 = Array.from({ length: total }, () => ({}));
  for (let h = 0; h < hist; h++) {
    const B = state.histBS;
    const shareCapital = B.shareCapital[h] || 0, reserves = B.reserves[h] || 0;
    const netWorth = shareCapital + reserves;
    const tlOutstanding = B.tlOutstanding[h] || 0;
    const quasiEquity = B.quasiEquity[h] || 0, unsecuredNBFC = B.unsecuredNBFC[h] || 0, unsecuredFriends = B.unsecuredFriends[h] || 0;
    const totalUnsecured = quasiEquity + unsecuredNBFC + unsecuredFriends;
    const dtl = B.dtl[h] || 0;
    const wcBorrowings = B.wcBorrowings[h] || 0, tradePayables = B.tradePayables[h] || 0, otherCL = B.otherCL[h] || 0, shortTermProv = B.shortTermProv[h] || 0;
    const totalLiab = netWorth + tlOutstanding + totalUnsecured + dtl + wcBorrowings + tradePayables + otherCL + shortTermProv;
    const grossBlock = B.grossBlock[h] || 0, accumDeprBS = B.accumDeprBS[h] || 0;
    const netBlock = grossBlock - accumDeprBS;
    const cwip = B.cwip[h] || 0;
    const investments = (B.longTermInv[h] || 0) + (B.otherLTA[h] || 0);
    const stocks = B.inventories[h] || 0, receivables = B.receivables[h] || 0, cashBank = B.cashBank[h] || 0;
    const otherCA = (B.stLoansAdv[h] || 0) + (B.otherCA[h] || 0);
    const totalAssets = netBlock + cwip + investments + stocks + receivables + cashBank + otherCA;
    const balanceCheck = totalLiab - totalAssets;
    Object.assign(ann5[h], { shareCapital, reserves, netWorth, tlOutstanding, quasiEquity, unsecuredNBFC, unsecuredFriends, totalUnsecured, dtl, wcBorrowings, tradePayables, otherCL, tlInstalments: 0, totalLiab, netBlock, cwip, investments, stocks, receivables, cashBank, otherCA, totalAssets, balanceCheck });
  }
  const lastHistInvestments = hist > 0 ? (state.histBS.longTermInv[hist - 1] || 0) + (state.histBS.otherLTA[hist - 1] || 0) : 0;
  for (let p = 0; p < proj; p++) {
    const idx = hist + p;
    const shareCapital = hist > 0 ? (state.histBS.shareCapital[hist - 1] || 0) : 0;
    const payout = Number(state.costAssumptions.dividendPayout) || 0;
    const priorReserves = p === 0 ? (hist > 0 ? (state.histBS.reserves[hist - 1] || 0) : 0) : ann5[idx - 1].reserves;
    const reserves = priorReserves + ann2[idx].pat - ann2[idx].pat * payout;
    const netWorth = shareCapital + reserves;
    const tlOutstanding = loan.totals.outstanding[p];
    const quasiEquity = hist > 0 ? (state.histBS.quasiEquity[hist - 1] || 0) : 0;
    const unsecuredNBFC = hist > 0 ? (state.histBS.unsecuredNBFC[hist - 1] || 0) : 0;
    const unsecuredFriends = hist > 0 ? (state.histBS.unsecuredFriends[hist - 1] || 0) : 0;
    const totalUnsecured = quasiEquity + unsecuredNBFC + unsecuredFriends;
    const dtl = 0;
    const wcBorrowings = ann3[idx].bankFinance, tradePayables = ann3[idx].creditors, otherCL = ann3[idx].otherCL, tlInstalments = ann3[idx].tlInstalments;
    const totalLiab = netWorth + tlOutstanding + totalUnsecured + dtl + wcBorrowings + tradePayables + otherCL + tlInstalments;
    const netBlock = depr.totals.netBlock[p];
    const cwip = 0;
    const investments = lastHistInvestments;
    const stocks = ann3[idx].totalStocks, receivables = ann3[idx].receivables, cashBank = ann3[idx].cashBank;
    const otherCA = totalLiab - netBlock - cwip - investments - stocks - receivables - cashBank;
    const totalAssets = netBlock + cwip + investments + stocks + receivables + cashBank + otherCA;
    const balanceCheck = totalLiab - totalAssets;
    Object.assign(ann5[idx], { shareCapital, reserves, netWorth, tlOutstanding, quasiEquity, unsecuredNBFC, unsecuredFriends, totalUnsecured, dtl, wcBorrowings, tradePayables, otherCL, tlInstalments, totalLiab, netBlock, cwip, investments, stocks, receivables, cashBank, otherCA, totalAssets, balanceCheck });
  }

  // ---- ANN6: profitability ratios (all years) ----
  const ann6 = ann2.map((A, i) => {
    const ns = A.netSales || 0;
    const div = (n, d) => (d ? (n / d) * 100 : 0);
    return {
      grossSales: A.grossSales, netSales: A.netSales, ebitda: A.ebitda, ebit: A.ebit, pbt: A.pbt, pat: A.pat, nca: A.nca,
      grossMargin: div(A.grossProfit, ns), ebitdaMargin: div(A.ebitda, ns), ebitMargin: div(A.ebit, ns),
      pbtMargin: div(A.pbt, ns), patMargin: div(A.pat, ns), ncaMargin: div(A.nca, ns),
      rmPctOut: div(A.rmConsumed, ns), employeePct: div(A.directLabour, ns), powerFuelPct: div(A.powerFuel, ns),
      otherMfgPct: div(A.otherMfg, ns), adminPct: div(A.adminSelling, ns), finChargePct: div(A.totalFinCharges, ns),
      returnOnNetWorth: div(A.pat, ann5[i].netWorth), returnOnCapEmployed: div(A.ebit, ann5[i].totalLiab),
      assetTurnover: ann5[i].totalAssets ? ns / ann5[i].totalAssets : 0,
    };
  });

  // ---- ANN7: WC ratios (all years) ----
  const ann7 = ann3.map((W, i) => {
    const A = ann2[i];
    const div = (n, d) => (d ? (n / d) * 12 : 0);
    return {
      currentRatioIncl: W.currentRatioIncl, currentRatioExcl: W.currentRatioExcl, gwc: W.gwc, nwc: W.nwc,
      rmNormMonths: state.wcNorms.rmMonths, rmActualMonths: div(W.rmStock, A.rmConsumed),
      debtorNormMonths: state.wcNorms.debtorsMonths, debtorActualMonths: div(W.receivables, A.netSales),
      creditorNormMonths: state.wcNorms.creditorsMonths, creditorActualMonths: div(W.creditors, A.rmConsumed),
      mpbf1: W.mpbf1, mpbf2: W.mpbf2, turnoverMethod: W.turnoverMethod, dpTotal: W.dpTotal, bankFinance: W.bankFinance,
      marginPctOfGWC: W.gwc ? (W.margin / W.gwc) * 100 : 0, bankFinPctOfGWC: W.gwc ? (W.bankFinance / W.gwc) * 100 : 0,
    };
  });

  // ---- ANN8: DSCR / Debt-Equity (all years; DSCR/DS meaningful for projected) ----
  const ann8 = ann2.map((A, i) => {
    const principal = i >= hist ? loan.totals.principal[i - hist] : 0;
    const fundsAvailable = A.pat + A.depr + A.interestTL;
    const debtService = principal + A.interestTL;
    const grossDSCR = debtService > 0.01 ? fundsAvailable / debtService : 0;
    const netDSCR = debtService > 0.01 ? (A.pat + A.interestTL) / debtService : 0;
    const tnw = ann5[i].netWorth;
    const ttl = ann5[i].tlOutstanding + ann5[i].totalUnsecured;
    const tol = ann5[i].totalLiab - tnw;
    const de = tnw ? ttl / tnw : 0;
    const tolTnw = tnw ? tol / tnw : 0;
    const quasi = ann5[i].quasiEquity;
    const adjNetWorth = tnw + quasi;
    const ttlExclQE = ttl - quasi;
    const adjDE = adjNetWorth ? ttlExclQE / adjNetWorth : 0;
    const totalDebt = ann5[i].tlOutstanding + ann5[i].wcBorrowings;
    const debtEbitda = A.ebitda ? totalDebt / A.ebitda : 0;
    const interestCoverage = A.totalFinCharges ? A.ebit / A.totalFinCharges : 0;
    return { fundsAvailable, principal, debtService, grossDSCR, netDSCR, tnw, ttl, tol, de, tolTnw, quasi, adjNetWorth, ttlExclQE, adjDE, debtEbitda, interestCoverage };
  });
  const projDSCRs = ann8.slice(hist).map(d => d.grossDSCR).filter(x => isFinite(x) && x > 0);
  const avgGrossDSCR = projDSCRs.length ? projDSCRs.reduce((a, b) => a + b, 0) / projDSCRs.length : 0;

  // ---- ANN9: Net worth movement ----
  const ann9 = ann5.map((B, i) => {
    const prelim = state.projectCost.prelim.existing + state.projectCost.prelim.proposed;
    const tnw = B.netWorth - prelim;
    const adjTnw = tnw + B.quasiEquity;
    const ttlExclQE = ann8[i].ttl - B.quasiEquity;
    const adjDE = adjTnw ? ttlExclQE / adjTnw : 0;
    return { shareCapital: B.shareCapital, reserves: B.reserves, netWorth: B.netWorth, dtl: B.dtl, adjNetWorth: B.netWorth + B.dtl, pat: ann2[i].pat, nca: ann2[i].nca, tnw, adjTnw, ttlExclQE, adjDE };
  });

  // ---- ANN1: Cost of project & means of finance (static, not year-wise) ----
  const PC = state.projectCost;
  const sumCost = (k) => (PC[k].existing || 0) + (PC[k].proposed || 0);
  const totalCapitalCost = ['land', 'buildings', 'pmImported', 'pmIndigenous', 'electrical', 'vehicles', 'computers', 'furniture', 'prelim', 'contingency'].reduce((s, k) => s + sumCost(k), 0);
  const totalCostOfProject = totalCapitalCost + sumCost('marginWC');
  const MF = state.meansOfFinance;
  const sumMF = (k) => (MF[k].existing || 0) + (MF[k].proposed || 0);
  const loanTotal = state.loans.reduce((s, L) => s + (Number(L.existingAmt) || 0) + (L.tranches || []).reduce((ts, t) => ts + (Number(t.amount) || 0), 0), 0);
  const totalMeansOfFinance = ['equityNew', 'promotersContrib', 'quasiEquity', 'unsecuredNBFC', 'unsecuredFriends', 'internalAccruals'].reduce((s, k) => s + sumMF(k), 0) + loanTotal;
  const ann1 = { totalCapitalCost, totalCostOfProject, totalMeansOfFinance, check: totalCostOfProject - totalMeansOfFinance };

  // ---- CASH FLOW STATEMENT (indirect method, derived from actual BS movements) ----
  // Index 0 has no prior year to compare against, so it stays null.
  const cashFlow = [null];
  for (let i = 1; i < total; i++) {
    const A = ann2[i], B = ann5[i], Bp = ann5[i - 1];
    const pat = A.pat, deprAmt = A.depr;
    const fundsFromOps = pat + deprAmt;
    const dTradePayables = B.tradePayables - Bp.tradePayables;
    const dOtherCL = B.otherCL - Bp.otherCL;
    const dInventories = -(B.stocks - Bp.stocks);
    const dReceivables = -(B.receivables - Bp.receivables);
    const dOtherCA = -(B.otherCA - Bp.otherCA);
    const wcChange = dTradePayables + dOtherCL + dInventories + dReceivables + dOtherCA;
    const cfOperating = fundsFromOps + wcChange;

    const capex = i < hist ? ((state.histBS.grossBlock[i] || 0) - (state.histBS.grossBlock[i - 1] || 0)) : ASSET_BLOCKS.reduce((s, b) => s + depr.byBlock[b.key].additions[i - hist], 0);
    const dInvestments = -(B.investments - Bp.investments);
    const cfInvesting = -capex + dInvestments;

    const dShareCapital = B.shareCapital - Bp.shareCapital;
    const dTL = B.tlOutstanding - Bp.tlOutstanding;
    const dUnsecured = B.totalUnsecured - Bp.totalUnsecured;
    const dWCBorrow = B.wcBorrowings - Bp.wcBorrowings;
    const dividendPaid = i >= hist ? A.pat * (Number(state.costAssumptions.dividendPayout) || 0) : 0;
    const cfFinancing = dShareCapital + dTL + dUnsecured + dWCBorrow - dividendPaid;

    const netCashFlow = cfOperating + cfInvesting + cfFinancing;
    const openingCash = Bp.cashBank;
    const closingCashComputed = openingCash + netCashFlow;
    const closingCashActual = B.cashBank;
    const reconciliationDiff = closingCashActual - closingCashComputed;

    cashFlow.push({ pat, deprAmt, fundsFromOps, dTradePayables, dOtherCL, dInventories, dReceivables, dOtherCA, wcChange, cfOperating, capex, dInvestments, cfInvesting, dShareCapital, dTL, dUnsecured, dWCBorrow, dividendPaid, cfFinancing, netCashFlow, openingCash, closingCashComputed, closingCashActual, reconciliationDiff });
  }

  return { labels, types, hist, proj, total, depr, loan, ann1, ann2, ann3, ann4a, ann5, ann6, ann7, ann8, ann9, cashFlow, avgGrossDSCR };
}

module.exports = { ASSET_BLOCKS, fyLabel, buildYearMeta, computeAll };

// scripts/lib/batch-date.js
// Single source of truth for "today" across retire/render/photo-fit.
// Basis: LOCAL calendar day (matches operator + runbook intent).
// Override order: --date <YYYY-MM-DD> > positional YYYY-MM-DD arg (legacy
// render-batch CLI) > env DK_BATCH_DATE > local today.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; // local, NOT UTC
}

function resolveBatchDate(argv = process.argv.slice(2)) {
  let value;
  let basis;
  const i = argv.indexOf('--date');
  if (i !== -1 && argv[i + 1]) {
    value = argv[i + 1];
    basis = '--date flag';
  } else {
    const positional = argv.find((a) => DATE_RE.test(a));
    if (positional) {
      value = positional;
      basis = 'positional arg';
    } else if (process.env.DK_BATCH_DATE) {
      value = process.env.DK_BATCH_DATE;
      basis = 'DK_BATCH_DATE env';
    } else {
      value = localToday();
      basis = 'local today';
    }
  }
  if (!DATE_RE.test(value)) {
    console.error(`✗ invalid batch date "${value}" — expected YYYY-MM-DD`);
    process.exit(1);
  }
  return { date: value, basis };
}

function logResolved({ date, basis }, label) {
  console.log(`◆ ${label} · batch date: ${date} (basis: ${basis}, local now: ${new Date().toString()})`);
}

module.exports = { resolveBatchDate, logResolved, DATE_RE };

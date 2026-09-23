import { it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { getStudySeries } from '../src/core/data.js';

function fixture({ rows, duplicates = false, ambiguousPlots = false, missingIdentity = false } = {}) {
  const study = {
    id: () => 'local-id',
    metaInfo: () => ({ description: 'Synthetic Ribbon', plots: [{ id: 'p0', type: 'line' }, { id: 'p1', type: 'line' }, { id: 'p2', type: 'line' }], styles: { p0: { title: 'High' }, p1: { title: ambiguousPlots ? 'High' : 'Low' }, p2: { title: 'Basis' } }, filledAreas: [{ id: 'fill', type: 'plot_plot', objAId: 'p0', objBId: 'p1', title: 'Ribbon' }], inputs: [{ id: 'in_0', type: 'integer' }] }),
    inputs: () => ({ pineId: 'PUBLIC;synthetic', pineVersion: missingIdentity ? undefined : '1.0', text: 'SECRET', in_0: { v: 20 }, in_1: { v: 'SECRET' } }),
    data: () => ({ _items: rows ?? [{ index: 1, value: [1000, 3.123456789123, 2, 2.5] }, { index: 2, value: [2000, null, NaN, 3] }] }),
  };
  const api = { symbol: () => 'TEST:XYZ', resolution: () => '240' };
  const window = { TradingViewApi: { activeChart: () => api, _activeChartWidgetWV: { value: () => ({ _chartWidget: { model: () => ({ model: () => ({ dataSources: () => duplicates ? [study, study] : [study] }) }) } }) } } };
  return { evaluate: async expr => JSON.parse(JSON.stringify(vm.runInNewContext(expr, { window }))) };
}

it('returns selected hidden columns aligned to bar times without private inputs', async () => {
  const r = await getStudySeries({ study: 'Synthetic Ribbon', plots: ['High', 'p1'], count: 2, _deps: fixture() });
  assert.equal(r.symbol, 'TEST:XYZ');
  assert.deepEqual(r.plots.map(p => p.id), ['p0', 'p1']);
  assert.equal(r.rows[0].time, 1000);
  assert.equal(r.rows[0].values.p0.value, 3.123456789123);
  assert.equal(r.rows[1].values.p0.status, 'null');
  assert.equal(r.rows[1].values.p1.status, 'nonfinite');
  assert.equal(r.rows[0].completion, 'unknown');
  assert.equal(r.fills[0].objAId, 'p0');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});
it('rejects ambiguous studies and missing plots', async () => {
  await assert.rejects(getStudySeries({ study: 'Synthetic Ribbon', plots: ['High'], _deps: fixture({ duplicates: true }) }), /ambiguous/);
  await assert.rejects(getStudySeries({ study: 'Synthetic Ribbon', plots: ['Absent'], _deps: fixture() }), /plot/);
});
it('bounds rows and filters time without interpolation', async () => {
  const r = await getStudySeries({ study: 'local-id', plots: ['Basis'], count: 1, from: 1500, to: 2500, _deps: fixture() });
  assert.deepEqual(r.rows.map(x => x.time), [2000]);
  for (const count of [0, 501, 1.5, NaN]) await assert.rejects(getStudySeries({ study: 'x', plots: ['y'], count, _deps: fixture() }), /count/);
});

it('represents absent columns and rejects nonnumeric timestamps or empty ranges', async () => {
  const r = await getStudySeries({ study: 'local-id', plots: ['Low'], _deps: fixture({ rows: [{ value: [1000, 2] }] }) });
  assert.equal(r.rows[0].values.p1.status, 'absent');
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['Low'], from: 3000, _deps: fixture() }), /rows unavailable/);
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['Low'], _deps: fixture({ rows: [{ value: ['1000', 2] }] }) }), /timestamp/);
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['Low'], _deps: fixture({ rows: [{ value: [1000, 2] }, { value: [1000, 3] }] }) }), /increasing/);
});
it('rejects empty and duplicate selections, reversed times and keeps errors private', async () => {
  for (const plots of [[], ['High', 'High'], ['p0', 'High']]) await assert.rejects(getStudySeries({ study: 'local-id', plots, _deps: fixture() }));
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['Low'], from: 2000, to: 1000, _deps: fixture() }), /reversed/);
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['Low'], _deps: { evaluate: async () => { throw new Error('SECRET'); } } }), e => e.message === 'Study series access failed');
});
it('CLI exposes bounded series and validates before connecting', async () => {
  const { execFileSync } = await import('node:child_process');
  const help = execFileSync(process.execPath, ['src/cli/index.js', 'data', 'series', '--help'], { encoding: 'utf8' });
  assert.match(help, /--plots/);
  assert.throws(() => execFileSync(process.execPath, ['src/cli/index.js', 'data', 'series', '--study', 'Synthetic', '--plots', 'High', '--count', '501'], { encoding: 'utf8', stdio: 'pipe' }), e => e.stderr.includes('count must be'));
});

it('rejects ambiguous plot names and treats output strings as nonnumeric', async () => {
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['High'], _deps: fixture({ ambiguousPlots: true }) }), /ambiguous plot/);
  const r = await getStudySeries({ study: 'local-id', plots: ['High'], _deps: fixture({ rows: [{ value: [1000, 'SECRET'] }] }) });
  assert.equal(r.rows[0].values.p0.status, 'nonnumeric');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

it('fails explicitly without stable published script identity', async () => {
  await assert.rejects(getStudySeries({ study: 'local-id', plots: ['High'], _deps: fixture({ missingIdentity: true }) }), /identity unavailable/);
});

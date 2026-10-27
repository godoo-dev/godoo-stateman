import { writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { plan } from '@godoo-dev/stateman';
import { planningWorkload } from './planning-workload.js';

it('measures the fictional multi-company catalog', async () => {
  const measurements = [];
  const sizes = (process.env.GODOO_BENCH_SIZES ?? '30,100,300').split(',').map(Number);
  for (const size of sizes) {
    const fixture = planningWorkload(size);
    const started = performance.now();
    const result = await plan(fixture.definitions, fixture.store.connection(), fixture.options);
    const elapsedMs = performance.now() - started;
    const unique = new Set(fixture.calls.map(call => JSON.stringify(call)));
    const companyReads = fixture.calls.filter(call => call.model === 'catalog.product' && call.fields.some(f => f.startsWith('property_')) && call.fields.every(f => f === 'id' || f.startsWith('property_')));
    measurements.push({ size, elapsedMs, calls: fixture.calls.length, unique: unique.size,
      duplicates: fixture.calls.length - unique.size, companyReads: companyReads.length,
      schemas: fixture.schemas.length, bytes: Buffer.byteLength(JSON.stringify(result)), operations: result.operations.length,
      sequentialLatencyEstimateMsAt50ms: fixture.calls.length * 50 });
    expect(result.operations).toEqual([]);
    expect(unique.size).toBe(fixture.calls.length);
    expect(companyReads).toHaveLength(9 * Math.ceil(size / 100));
    expect(fixture.calls.length).toBeLessThanOrEqual(14 * Math.ceil(size / 100) + 40);
    expect(fixture.schemas).toHaveLength(4);
  }
  console.log(JSON.stringify(measurements));
  if (process.env.GODOO_BENCH_OUT) await writeFile(process.env.GODOO_BENCH_OUT, JSON.stringify({ node: process.version, injectedLatencyMs: 0, measurements }, null, 2));
}, 300_000);

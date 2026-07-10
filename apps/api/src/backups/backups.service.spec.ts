import { BackupsService } from './backups.service';

/**
 * Unit tests for the retention-pruning logic using a mocked Prisma client —
 * no real database or filesystem writes. Full end-to-end backup/restore
 * behaviour (gzip round-trip, FK-ordered export/import) is covered by
 * running against a real embedded Postgres instance during development;
 * see the project notes for that verification. This spec locks down the
 * "keep N most recent, delete the rest" selection contract in isolation.
 */
describe('BackupsService.pruneOldAutomatic', () => {
  function makePrisma(rowsBeyondKeep: { id: string; storageKey: string | null }[]) {
    const findMany = jest.fn().mockResolvedValue(rowsBeyondKeep);
    const deleteMany = jest.fn().mockResolvedValue({ count: rowsBeyondKeep.length });
    return { prisma: { backup: { findMany, deleteMany } } as any, findMany, deleteMany };
  }

  it('does nothing when there is nothing beyond the retention window', async () => {
    const { prisma, deleteMany } = makePrisma([]);
    const service = new BackupsService(prisma);
    const result = await service.pruneOldAutomatic('uni-1', 14);
    expect(result).toEqual({ pruned: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes exactly the rows returned beyond the retention window', async () => {
    const stale = [
      { id: 'b1', storageKey: 'b1.json.gz' },
      { id: 'b2', storageKey: 'b2.json.gz' },
      { id: 'b3', storageKey: null },
    ];
    const { prisma, findMany, deleteMany } = makePrisma(stale);
    const service = new BackupsService(prisma);
    const result = await service.pruneOldAutomatic('uni-1', 14);

    expect(result).toEqual({ pruned: 3 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { universityId: 'uni-1', type: 'AUTOMATIC', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      skip: 14,
    }));
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['b1', 'b2', 'b3'] } } });
  });

  it('tolerates a row with no storageKey without throwing', async () => {
    const { prisma } = makePrisma([{ id: 'b1', storageKey: null }]);
    const service = new BackupsService(prisma);
    await expect(service.pruneOldAutomatic('uni-1', 14)).resolves.toEqual({ pruned: 1 });
  });
});

// @vitest-environment node

import {
  createDatabaseManager,
  type DatabaseManager,
  type MigrationContext,
  type SeedContext,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import type { Knex } from 'knex';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import migration from '../../database/main/migrations/202609210001_create_test_progress_tables.js';
import issuesMigration from '../../database/main/migrations/202609210003_create_issues.js';
import problemTypeMigration from '../../database/main/migrations/202609220001_add_issue_type_and_owner.js';
import problemCommentsMigration from '../../database/main/migrations/202609220002_create_problem_comments.js';
import problemActivitiesMigration from '../../database/main/migrations/202609220003_create_problem_activities.js';
import ownerIdMigration from '../../database/main/migrations/202609220006_add_owner_id.js';
import seed from '../../database/main/seeds/202609210002_seed_test_progress_data.js';
import mergeSeed from '../../database/main/seeds/202609220003_seed_merge_missing_items_into_problems.js';
import ownerBackfillSeed from '../../database/main/seeds/202609220008_seed_backfill_owner_ids.js';
import {
  createTestProgressService,
  parseFeaturePointInput,
  parseProblemInput,
  TestProgressConflictError,
  TestProgressNotFoundError,
  TestProgressValidationError,
} from '../../server/providers/test-progress.js';

const tempDirs: string[] = [];
const databases: DatabaseManager[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createTestDatabase(): DatabaseManager {
  const dir = mkdtempSync(path.join(tmpdir(), 'test-progress-db-'));
  tempDirs.push(dir);
  const database = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({ filename: path.join(dir, 'test.sqlite') }),
    },
  });
  databases.push(database);
  return database;
}

/** The callbacks under test only use `builder`/`query`; the rest is runner context. */
function migrationContext(database: DatabaseManager): MigrationContext {
  return {
    builder: database.builder(),
    query: database.query(),
    connection: database.connection(),
  } as unknown as MigrationContext;
}

function seedContext(database: DatabaseManager): SeedContext {
  return {
    query: database.query(),
    connection: database.connection(),
  } as unknown as SeedContext;
}

/**
 * The tracker resolves owners and members against the Users plugin's collection,
 * which this test database does not migrate; a minimal shape is enough for the
 * queries the service runs (id, display name, username, soft-delete columns).
 */
async function createUsersCollection(database: DatabaseManager): Promise<void> {
  await database.builder().createCollection('user', (collection) => {
    collection.string('id', { primaryKey: true, length: 64, nullable: false });
    collection.string('name', { length: 255, nullable: false });
    collection.string('username', { length: 255 });
    collection.datetime('createdAt');
    collection.datetime('disabledAt');
    collection.datetime('deletedAt');
  });
}

async function migrateAndSeed(database: DatabaseManager): Promise<void> {
  await createUsersCollection(database);
  await migration.up(migrationContext(database));
  await issuesMigration.up(migrationContext(database));
  await problemTypeMigration.up(migrationContext(database));
  await problemCommentsMigration.up(migrationContext(database));
  await problemActivitiesMigration.up(migrationContext(database));
  await ownerIdMigration.up(migrationContext(database));
  await seed.run(seedContext(database));
  // The old seed fills missing_items; this pass moves its rows into problems.
  await mergeSeed.run(seedContext(database));
  await ownerBackfillSeed.run(seedContext(database));
}

async function knex(database: DatabaseManager): Promise<Knex> {
  await database.connect('main');
  return database.connection('main').client<Knex>();
}

describe('test progress schema', () => {
  it('creates both tables with their columns and reverses them', async () => {
    const database = createTestDatabase();
    await createUsersCollection(database);
    await migration.up(migrationContext(database));
    await issuesMigration.up(migrationContext(database));
    await problemTypeMigration.up(migrationContext(database));
    await ownerIdMigration.up(migrationContext(database));

    const client = await knex(database);
    expect(await client.schema.hasTable('feature_points')).toBe(true);
    expect(await client.schema.hasTable('missing_items')).toBe(true);
    expect(await client.schema.hasTable('issues')).toBe(true);

    const columns = await client('feature_points').columnInfo();
    for (const column of [
      'name',
      'level',
      'parent_id',
      'owner',
      'owner_id',
      'skills_status',
      'docs_status',
      'example_exists',
      'example_feature_status',
      'example_expected',
      'example_current',
      'status',
      'design_score',
      'design_note',
      'development_score',
      'development_note',
      'agent_friendliness_score',
      'agent_friendliness_note',
      'output_quality_score',
      'output_quality_note',
      'remark',
      'sort_order',
      'created_at',
      'updated_at',
    ]) {
      expect(columns, `feature_points.${column}`).toHaveProperty(column);
    }

    const missingColumns = await client('missing_items').columnInfo();
    for (const column of [
      'title',
      'feature_point_id',
      'status',
      'owner',
      'note',
      'created_at',
      'updated_at',
    ]) {
      expect(missingColumns, `missing_items.${column}`).toHaveProperty(column);
    }

    const issueColumns = await client('issues').columnInfo();
    for (const column of [
      'title',
      'description',
      'feature_point_id',
      'status',
      'type',
      'owner',
      'owner_id',
      'created_at',
      'updated_at',
    ]) {
      expect(issueColumns, `issues.${column}`).toHaveProperty(column);
    }

    await ownerIdMigration.down(migrationContext(database));
    await problemTypeMigration.down(migrationContext(database));
    await issuesMigration.down(migrationContext(database));
    await migration.down(migrationContext(database));
    expect(await client.schema.hasTable('issues')).toBe(false);
    expect(await client.schema.hasTable('feature_points')).toBe(false);
    expect(await client.schema.hasTable('missing_items')).toBe(false);
  });

  it('seeds the workbook once and leaves a second run alone', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);

    const service = createTestProgressService(database);
    const first = await service.listFeaturePoints();
    expect(first.filter((item) => item.level === 'dimension')).toHaveLength(5);
    expect(first.filter((item) => item.level === 'feature')).toHaveLength(28);

    const examples = await service.listProblems({ type: 'example' });
    expect(examples).toHaveLength(50);
    expect(examples.every((problem) => problem.status === 'pending')).toBe(true);

    // A second run must not duplicate anything, and must not overwrite edits.
    const target = first.find((item) => item.name === '数据库');
    expect(target).toBeDefined();
    await service.updateFeaturePoint(target!.id, { owner: 'edited-owner' });
    await seed.run(seedContext(database));

    const second = await service.listFeaturePoints();
    expect(second).toHaveLength(33);
    expect((await service.listProblems({ type: 'example' })).length).toBe(50);
    expect(second.find((item) => item.name === '数据库')?.owner).toBe(
      'edited-owner',
    );
  });

  it('derives the parent name, missing-item counts and summary', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    const databaseFeature = (await service.listFeaturePoints()).find(
      (item) => item.name === '数据库',
    );
    expect(databaseFeature).toMatchObject({
      parentName: '应用搭建',
      level: 'feature',
      skillsStatus: 'missing',
      status: 'developed',
    });
    expect(databaseFeature?.problems.example).toEqual({ total: 4, open: 4 });
    expect(databaseFeature?.problems.skills).toEqual({ total: 0, open: 0 });

    const summary = await service.getSummary();
    expect(summary.totals).toEqual({
      dimensions: 5,
      features: 28,
      materialProblems: 50,
      openMaterialProblems: 50,
      testProblems: 0,
      openTestProblems: 0,
    });
    expect(summary.statusCounts.deferred).toBe(5);
    expect(summary.statusCounts.testCompleted).toBe(3);
    expect(summary.readiness.skills.missing).toBe(1);
    expect(summary.readiness.skills.complete).toBe(0);
    // 知识库 has no example, so its criteria cell reads "missing".
    expect(summary.readiness.example.missing).toBe(1);
    expect(summary.readiness.example.complete).toBe(0);
    expect(summary.exampleExists.no).toBe(1);
    expect(summary.problems.example).toEqual({ total: 50, open: 50 });

    const applicationBuild = summary.dimensions.find(
      (dimension) => dimension.name === '应用搭建',
    );
    expect(applicationBuild).toMatchObject({
      featureCount: 18,
      problems: { total: 50, open: 50 },
    });
  });

  it('keeps the two-level tree and rejects a feature point without a dimension', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    await expect(
      service.createFeaturePoint({ name: 'no dimension', level: 'feature' }),
    ).rejects.toBeInstanceOf(TestProgressValidationError);

    const feature = (await service.listFeaturePoints()).find(
      (item) => item.name === '数据库',
    );
    await expect(
      service.createFeaturePoint({
        name: 'nested feature',
        level: 'feature',
        parentId: feature!.id,
      }),
    ).rejects.toBeInstanceOf(TestProgressValidationError);

    await expect(
      service.createFeaturePoint({
        name: 'missing parent',
        level: 'feature',
        parentId: 99999,
      }),
    ).rejects.toBeInstanceOf(TestProgressNotFoundError);
  });

  it('creates, updates and deletes feature points and missing items', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用搭建',
    )!;

    const created = await service.createFeaturePoint({
      name: '临时功能点',
      level: 'feature',
      parentId: dimension.id,
      owner: 'tester',
      status: 'testable',
    });
    expect(created).toMatchObject({
      name: '临时功能点',
      parentName: '应用搭建',
      status: 'testable',
    });
    expect(created.problems.example).toEqual({ total: 0, open: 0 });
    expect(created.problems.skills).toEqual({ total: 0, open: 0 });

    const updated = await service.updateFeaturePoint(created.id, {
      status: 'developed',
      designScore: 8.5,
      designNote: 'solid',
    });
    expect(updated).toMatchObject({
      status: 'developed',
      designScore: 8.5,
      designNote: 'solid',
    });

    const problem = await service.createProblem({
      title: '缺少演示',
      featurePointId: created.id,
      type: 'example',
    });
    expect(problem).toMatchObject({
      type: 'example',
      status: 'pending',
      featurePointName: '临时功能点',
    });

    const verified = await service.updateProblem(problem.id, {
      status: 'verified',
      owner: 'tester',
    });
    expect(verified).toMatchObject({ status: 'verified', owner: 'tester' });

    const withProblem = await service.getFeaturePoint(created.id);
    expect(withProblem.problems.example).toEqual({ total: 1, open: 0 });
    expect(withProblem.problems.docs).toEqual({ total: 0, open: 0 });

    await service.deleteProblem(problem.id);
    await expect(service.getProblem(problem.id)).rejects.toBeInstanceOf(
      TestProgressNotFoundError,
    );

    await service.deleteFeaturePoint(created.id);
    await expect(service.getFeaturePoint(created.id)).rejects.toBeInstanceOf(
      TestProgressNotFoundError,
    );
  });

  it('refuses to delete a dimension that still has feature points', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用测试',
    )!;
    await expect(
      service.deleteFeaturePoint(dimension.id),
    ).rejects.toBeInstanceOf(TestProgressConflictError);
  });

  it('tracks problems through their statuses and types', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    const feature = (await service.listFeaturePoints()).find(
      (item) => item.name === '认证',
    )!;
    const created = await service.createProblem({
      title: '验证码登录偶发失败',
      description: '并发登录时出现',
      featurePointId: feature.id,
      type: 'manual',
    });
    expect(created).toMatchObject({
      title: '验证码登录偶发失败',
      type: 'manual',
      status: 'pending',
      featurePointName: '认证',
    });

    const fixing = await service.updateProblem(created.id, { status: 'fixing' });
    expect(fixing.status).toBe('fixing');

    const listed = await service.listProblems({
      featurePointId: feature.id,
      status: 'fixing',
    });
    expect(listed.map((problem) => problem.id)).toEqual([created.id]);
    // The open filter is the one the criteria cells link to; the seeded example
    // gaps of this feature point are open as well.
    expect(
      await service.listProblems({
        featurePointId: feature.id,
        type: 'manual',
        open: true,
      }),
    ).toHaveLength(1);
    expect(
      await service.listProblems({ featurePointId: feature.id, type: 'skills' }),
    ).toHaveLength(0);

    const open = (await service.listFeaturePoints()).find(
      (item) => item.id === feature.id,
    );
    expect(open?.problems.manual).toEqual({ total: 1, open: 1 });
    expect(open?.problems.skills).toEqual({ total: 0, open: 0 });

    await service.updateProblem(created.id, { status: 'verified' });
    const verified = (await service.listFeaturePoints()).find(
      (item) => item.id === feature.id,
    );
    expect(verified?.problems.manual).toEqual({ total: 1, open: 0 });
    expect(
      await service.listProblems({
        featurePointId: feature.id,
        type: 'manual',
        open: true,
      }),
    ).toHaveLength(0);

    const summary = await service.getSummary();
    expect(summary.totals.testProblems).toBe(1);
    expect(summary.totals.openTestProblems).toBe(0);
    expect(summary.totals.openMaterialProblems).toBe(50);
    expect(
      summary.dimensions.find((dimension) => dimension.name === '应用搭建')
        ?.problems,
    ).toEqual({ total: 51, open: 50 });

    await service.deleteProblem(created.id);
    await expect(service.getProblem(created.id)).rejects.toBeInstanceOf(
      TestProgressNotFoundError,
    );
  });

  it("keeps comments with their author and only deletes the author's own", async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    const problem = (await service.listProblems({ type: 'example' }))[0];
    const author = { id: 'user-1', name: 'chenlin' };
    const other = { id: 'user-2', name: 'yangqia' };

    const created = await service.createProblemComment(
      problem.id,
      { content: '第一条\n\n| A | B |' },
      author,
    );
    expect(created).toMatchObject({
      problemId: problem.id,
      authorId: 'user-1',
      authorName: 'chenlin',
      content: '第一条\n\n| A | B |',
    });
    expect(created.createdAt).not.toBe('');
    expect(await service.listProblemComments(problem.id)).toHaveLength(1);

    // Anyone else deleting it sees "not found", so existence is not revealed.
    await expect(
      service.deleteProblemComment(created.id, other),
    ).rejects.toBeInstanceOf(TestProgressNotFoundError);

    await service.deleteProblemComment(created.id, author);
    expect(await service.listProblemComments(problem.id)).toHaveLength(0);

    await expect(
      service.createProblemComment(999999, { content: 'x' }, author),
    ).rejects.toBeInstanceOf(TestProgressNotFoundError);
  });

  it('filters problems by owner', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用测试',
    )!;
    const actor = { id: 'user-1', name: '陈霖' };
    await service.createProblem(
      { title: '陈霖的问题', featurePointId: dimension.id, owner: '陈霖' },
      actor,
    );
    await service.createProblem(
      { title: '龚诚的问题', featurePointId: dimension.id, owner: '龚诚' },
      actor,
    );
    await service.createProblem(
      { title: '未分配的问题', featurePointId: dimension.id },
      actor,
    );

    expect(
      (await service.listProblems({ owner: '陈霖' })).map((p) => p.title),
    ).toEqual(['陈霖的问题']);
    expect((await service.listProblems({ owner: '无人' }))).toHaveLength(0);
    // 50 problems come from the workbook seed; the three above are added here.
    expect(await service.listProblems()).toHaveLength(53);
  });

  it('associates owners with accounts and backfills owner names', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);
    const client = await knex(database);
    await client('user').insert([
      { id: 'account-chenlin', name: '陈霖', username: 'chenlin' },
      { id: 'account-gongcheng', name: '龚诚', username: 'gongcheng' },
    ]);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用测试',
    )!;

    // ownerId is authoritative and the display name comes from the account.
    const created = await service.createProblem(
      {
        title: '按账号分配',
        featurePointId: dimension.id,
        ownerId: 'account-chenlin',
      },
      { id: 'actor', name: 'actor' },
    );
    expect(created).toMatchObject({
      owner: '陈霖',
      ownerId: 'account-chenlin',
    });
    expect(
      (await service.listProblems({ ownerId: 'account-chenlin' })).map(
        (problem) => problem.title,
      ),
    ).toEqual(['按账号分配']);
    expect(
      await service.listProblems({ ownerId: 'account-gongcheng' }),
    ).toHaveLength(0);

    // An unknown account id is rejected instead of being stored as free text.
    await expect(
      service.createProblem(
        {
          title: '未知账号',
          featurePointId: dimension.id,
          ownerId: 'account-missing',
        },
        { id: 'actor', name: 'actor' },
      ),
    ).rejects.toBeInstanceOf(TestProgressValidationError);

    // A name-only write resolves to the account when the name is unique.
    const byName = await service.createProblem(
      { title: '按姓名分配', featurePointId: dimension.id, owner: '龚诚' },
      { id: 'actor', name: 'actor' },
    );
    expect(byName).toMatchObject({
      owner: '龚诚',
      ownerId: 'account-gongcheng',
    });

    // Clearing the owner clears the association and the legacy text together.
    const cleared = await service.updateProblem(
      byName.id,
      { ownerId: null },
      { id: 'actor', name: 'actor' },
    );
    expect(cleared).toMatchObject({ owner: null, ownerId: null });

    // The backfill maps rows that only carry a name, and leaves unknown names.
    const featurePoint = (await service.listFeaturePoints()).find(
      (item) => item.name === '数据库',
    )!;
    await client('feature_points')
      .where('id', '=', featurePoint.id)
      .update({ owner: '陈霖', owner_id: null });
    await ownerBackfillSeed.run(seedContext(database));
    expect(
      (await service.listFeaturePoints()).find(
        (item) => item.id === featurePoint.id,
      ),
    ).toMatchObject({ owner: '陈霖', ownerId: 'account-chenlin' });

    await client('feature_points')
      .where('id', '=', featurePoint.id)
      .update({ owner: '无人', owner_id: null });
    await ownerBackfillSeed.run(seedContext(database));
    expect(
      (await service.listFeaturePoints()).find(
        (item) => item.id === featurePoint.id,
      ),
    ).toMatchObject({ owner: '无人', ownerId: null });
  });

  it('keeps an owner sent by name through the create parsers', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);
    const client = await knex(database);
    await client('user').insert([
      { id: 'account-chenlin', name: '陈霖', username: 'chenlin' },
    ]);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用测试',
    )!;

    // A create that sends a name must not look like "clear the owner": the parser
    // leaves ownerId undefined so the name resolves to the account.
    const problemInput = parseProblemInput(
      { title: '按姓名创建', featurePointId: dimension.id, owner: '陈霖' },
      { partial: false },
    );
    expect(problemInput.ownerId).toBeUndefined();
    const created = await service.createProblem(problemInput, {
      id: 'actor',
      name: 'actor',
    });
    expect(created).toMatchObject({
      owner: '陈霖',
      ownerId: 'account-chenlin',
    });

    const featureInput = parseFeaturePointInput(
      {
        name: '按姓名建的功能点',
        level: 'feature',
        parentId: dimension.id,
        owner: '陈霖',
      },
      { partial: false },
    );
    expect(featureInput.ownerId).toBeUndefined();
    const feature = await service.createFeaturePoint(featureInput);
    expect(feature).toMatchObject({
      owner: '陈霖',
      ownerId: 'account-chenlin',
    });
  });

  it('records a timeline and treats cancelled as closed', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);
    const client = await knex(database);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用测试',
    )!;
    const created = await service.createProblem(
      { title: '时间线问题', featurePointId: dimension.id, type: 'manual' },
      { id: 'user-1', name: 'chenlin' },
    );

    let activities = await service.listProblemActivities(created.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      kind: 'created',
      actorName: 'chenlin',
      fromStatus: null,
      toStatus: 'pending',
    });
    expect(activities[0].createdAt).not.toBe('');

    await service.updateProblem(
      created.id,
      { status: 'fixing' },
      { id: 'user-2', name: 'yangqia' },
    );
    activities = await service.listProblemActivities(created.id);
    expect(activities).toHaveLength(2);
    expect(activities[1]).toMatchObject({
      kind: 'status',
      actorName: 'yangqia',
      fromStatus: 'pending',
      toStatus: 'fixing',
    });

    // Editing a field that is not the status adds no timeline entry.
    await service.updateProblem(
      created.id,
      { owner: 'chenlin' },
      { id: 'user-1', name: 'chenlin' },
    );
    expect(await service.listProblemActivities(created.id)).toHaveLength(2);

    // Cancelled closes the problem: it leaves the open filter and the gaps.
    await service.updateProblem(
      created.id,
      { status: 'cancelled' },
      { id: 'user-1', name: 'chenlin' },
    );
    expect(await service.listProblemActivities(created.id)).toHaveLength(3);
    expect(
      await service.listProblems({
        featurePointId: dimension.id,
        type: 'manual',
        open: true,
      }),
    ).toHaveLength(0);
    const summary = await service.getSummary();
    expect(summary.problems.manual).toEqual({ total: 1, open: 0 });
    expect(summary.totals.testProblems).toBe(1);
    expect(summary.totals.openTestProblems).toBe(0);

    await service.deleteProblem(created.id);
    const rows = await client('problem_activities')
      .where('problem_id', '=', created.id)
      .select('id');
    expect(rows).toHaveLength(0);
  });

  it('removes a problem together with its comments', async () => {
    const database = createTestDatabase();
    await migrateAndSeed(database);
    const service = createTestProgressService(database);
    const client = await knex(database);

    const dimension = (await service.listFeaturePoints()).find(
      (item) => item.name === '应用测试',
    )!;
    const problem = await service.createProblem({
      title: '临时问题',
      featurePointId: dimension.id,
      type: 'manual',
    });
    await service.createProblemComment(
      problem.id,
      { content: '评论' },
      { id: 'user-1', name: 'chenlin' },
    );

    await service.deleteProblem(problem.id);
    const rows = await client('problem_comments')
      .where('problem_id', '=', problem.id)
      .select('id');
    expect(rows).toHaveLength(0);
  });

  it('validates enum, score and id input before it reaches the database', () => {
    expect(() =>
      parseFeaturePointInput(
        { name: 'bad status', status: 'nonsense' },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);
    expect(() =>
      parseFeaturePointInput(
        { name: 'bad score', designScore: 11 },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);
    expect(() =>
      parseFeaturePointInput({ name: '' }, { partial: false }),
    ).toThrow(TestProgressValidationError);
    expect(() =>
      parseProblemInput(
        { title: 'x', featurePointId: 0 },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);
    expect(() =>
      parseProblemInput(
        { title: 'x', featurePointId: 1, status: 'nonsense' },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);
    expect(() =>
      parseProblemInput(
        { title: 'x', featurePointId: 1, type: 'nonsense' },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);
    // Skills/docs are availability flags; the retired coverage grades are refused.
    expect(() =>
      parseFeaturePointInput(
        { name: 'retired skills value', skillsStatus: 'partial' },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);
    expect(() =>
      parseFeaturePointInput(
        { name: 'retired docs value', docsStatus: 'complete' },
        { partial: false },
      ),
    ).toThrow(TestProgressValidationError);

    // A PATCH only validates the keys it carries.
    expect(
      parseFeaturePointInput({ status: 'deferred' }, { partial: true }),
    ).toEqual({ status: 'deferred' });
    expect(parseFeaturePointInput({}, { partial: true })).toEqual({});
    expect(
      parseFeaturePointInput({ skillsStatus: 'available' }, { partial: true }),
    ).toEqual({ skillsStatus: 'available' });
  });
});

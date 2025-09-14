/**
 * PostgreSQL向量数据库控制器
 * 
 * 基于PgVector扩展实现的向量数据库操作层，是FastGPT RAG系统的核心存储组件。
 * 主要功能包括：
 * 1. 向量数据的增删改查操作
 * 2. 高效的向量相似度搜索（基于HNSW索引）
 * 3. 多维度的数据过滤和筛选
 * 4. 数据库表结构初始化和索引优化
 * 5. 统计和监控功能
 * 
 * 技术特点：
 * - 使用PgVector扩展支持向量操作
 * - HNSW索引提供高效的近似最近邻搜索
 * - 支持1536维向量存储
 * - 多级索引优化查询性能
 * - 事务支持确保数据一致性
 * 
 * 核心方法：
 * - init: 初始化数据库表和索引
 * - insert: 批量插入向量数据
 * - delete: 删除向量数据
 * - embRecall: 向量相似度检索
 * - getVectorCountBy*: 各种统计查询
 */

import { DatasetVectorTableName } from '../constants';
import { delay, retryFn } from '@fastgpt/global/common/system/utils';
import { PgClient, connectPg } from './controller';
import { type PgSearchRawType } from '@fastgpt/global/core/dataset/api';
import type {
  DelDatasetVectorCtrlProps,
  EmbeddingRecallCtrlProps,
  EmbeddingRecallResponse,
  InsertVectorControllerProps
} from '../controller.d';
import dayjs from 'dayjs';
import { addLog } from '../../system/log';

/**
 * PostgreSQL向量数据库控制器类
 * 
 * 封装了所有向量数据库的操作方法，提供统一的接口供上层业务调用。
 */
export class PgVectorCtrl {
  constructor() {}
  
  /**
   * 初始化向量数据库
   * 
   * 执行以下初始化操作：
   * 1. 连接PostgreSQL数据库
   * 2. 创建vector扩展（如果不存在）
   * 3. 创建向量数据表（如果不存在）
   * 4. 创建HNSW向量索引（提高检索性能）
   * 5. 创建复合索引（优化过滤查询）
   * 6. 创建时间索引（支持时间范围查询）
   * 
   * 表结构说明：
   * - id: 主键，自增长整数
   * - vector: 1536维向量，使用PgVector的VECTOR类型
   * - team_id: 团队ID，用于多租户数据隔离
   * - dataset_id: 数据集ID，用于数据集级别的管理
   * - collection_id: 集合ID，用于更细粒度的数据组织
   * - createtime: 创建时间，默认为当前时间戳
   * 
   * 索引说明：
   * - vector_index: HNSW向量索引，用于高效的向量相似度搜索
   * - team_dataset_collection_index: 复合B-tree索引，优化多条件过滤
   * - create_time_index: 时间索引，支持时间范围查询
   * 
   * @returns Promise<void> - 异步初始化完成
   * 
   * @example
   * ```typescript
   * const pgVector = new PgVectorCtrl();
   * await pgVector.init();
   * ```
   */
  init = async () => {
    try {
      // 1. 连接PostgreSQL数据库
      await connectPg();
      
      // 2. 创建vector扩展和数据表
      await PgClient.query(`
        CREATE EXTENSION IF NOT EXISTS vector;  -- 启用PgVector扩展
        CREATE TABLE IF NOT EXISTS ${DatasetVectorTableName} (
            id BIGSERIAL PRIMARY KEY,                    -- 主键，自增长
            vector VECTOR(1536) NOT NULL,                -- 1536维向量
            team_id VARCHAR(50) NOT NULL,                -- 团队ID
            dataset_id VARCHAR(50) NOT NULL,             -- 数据集ID
            collection_id VARCHAR(50) NOT NULL,          -- 集合ID
            createtime TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 创建时间
        );
      `);

      // 3. 创建HNSW向量索引（并发创建，不阻塞其他操作）
      await PgClient.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS vector_index ON ${DatasetVectorTableName} USING hnsw (vector vector_ip_ops) WITH (m = 32, ef_construction = 128);`
        // HNSW参数说明：
        // - vector_ip_ops: 使用内积操作符（适合标准化向量）
        // - m = 32: 每个节点的最大连接数，影响索引质量和大小
        // - ef_construction = 128: 构建时的搜索宽度，影响索引构建质量
      );
      
      // 4. 创建复合B-tree索引（优化多条件过滤查询）
      await PgClient.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS team_dataset_collection_index ON ${DatasetVectorTableName} USING btree(team_id, dataset_id, collection_id);`
        // 复合索引顺序：team_id -> dataset_id -> collection_id
        // 支持前缀匹配，可以优化各种组合查询
      );
      
      // 5. 创建时间索引（支持时间范围查询和数据清理）
      await PgClient.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS create_time_index ON ${DatasetVectorTableName} USING btree(createtime);`
      );
      // 6. 自动清理配置（根据数据量调整，当前已注释）
      // 针对不同数据规模的autovacuum优化配置：
      
      // 10万行数据的配置
      // await PgClient.query(`
      //   ALTER TABLE ${DatasetVectorTableName} SET (
      //     autovacuum_vacuum_scale_factor = 0.1,    -- 10%的行变更后触发vacuum
      //     autovacuum_analyze_scale_factor = 0.05,  -- 5%的行变更后触发analyze
      //     autovacuum_vacuum_threshold = 50,        -- 最小vacuum阈值
      //     autovacuum_analyze_threshold = 50,       -- 最小analyze阈值
      //     autovacuum_vacuum_cost_delay = 20,       -- vacuum延迟（毫秒）
      //     autovacuum_vacuum_cost_limit = 200       -- vacuum成本限制
      //   );`);

      // 100万行数据的配置
      // await PgClient.query(`
      //   ALTER TABLE ${DatasetVectorTableName} SET (
      //     autovacuum_vacuum_scale_factor = 0.01,   -- 1%的行变更后触发vacuum
      //     autovacuum_analyze_scale_factor = 0.02,  -- 2%的行变更后触发analyze
      //     autovacuum_vacuum_threshold = 1000,      -- 更高的最小阈值
      //     autovacuum_analyze_threshold = 1000,     -- 更高的最小阈值
      //     autovacuum_vacuum_cost_delay = 10,       -- 更短的延迟
      //     autovacuum_vacuum_cost_limit = 2000      -- 更高的成本限制
      //   );`)

      addLog.info('init pg successful');
    } catch (error) {
      addLog.error('init pg error', error);
    }
  };
  /**
   * 批量插入向量数据
   * 
   * 将多个向量及其元数据批量插入到向量数据库中。
   * 这是向量数据入库的主要接口，支持高效的批量操作。
   * 
   * 数据组织层次：
   * Team -> Dataset -> Collection -> Vector
   * 
   * @param props - 插入参数
   * @param props.teamId - 团队ID，用于多租户数据隔离
   * @param props.datasetId - 数据集ID，用于数据集级别的管理
   * @param props.collectionId - 集合ID，用于更细粒度的数据组织
   * @param props.vectors - 向量数组，每个向量为1536维的数字数组
   * 
   * @returns Promise<{insertIds: string[]}> - 返回插入记录的ID列表
   * 
   * @throws 当插入失败时抛出错误
   * 
   * @example
   * ```typescript
   * const result = await pgVector.insert({
   *   teamId: 'team_123',
   *   datasetId: 'dataset_456',
   *   collectionId: 'collection_789',
   *   vectors: [
   *     [0.1, 0.2, 0.3, ...], // 1536维向量
   *     [0.4, 0.5, 0.6, ...], // 1536维向量
   *   ]
   * });
   * console.log('插入的记录ID:', result.insertIds);
   * ```
   */
  insert = async (props: InsertVectorControllerProps): Promise<{ insertIds: string[] }> => {
    const { teamId, datasetId, collectionId, vectors } = props;

    // 1. 构造插入数据：将向量和元数据组合
    const values = vectors.map((vector) => [
      { key: 'vector', value: `[${vector}]` },              // 向量数据，转换为PgVector格式
      { key: 'team_id', value: String(teamId) },            // 团队ID
      { key: 'dataset_id', value: String(datasetId) },      // 数据集ID
      { key: 'collection_id', value: String(collectionId) } // 集合ID
      // createtime字段使用数据库默认值（CURRENT_TIMESTAMP）
    ]);

    // 2. 执行批量插入操作
    const { rowCount, rows } = await PgClient.insert(DatasetVectorTableName, {
      values
    });

    // 3. 验证插入结果
    if (rowCount === 0) {
      return Promise.reject('insertDatasetData: no insert');
    }

    // 4. 返回插入记录的ID列表
    return {
      insertIds: rows.map((row) => row.id)
    };
  };
  /**
   * 删除向量数据
   * 
   * 支持多种删除模式，提供灵活的数据清理功能：
   * 1. 按单个ID删除
   * 2. 按数据集ID删除（可选择特定集合）
   * 3. 按ID列表批量删除
   * 
   * 安全机制：
   * - 必须提供teamId进行权限验证
   * - 支持多种删除条件的组合
   * - 自动处理空条件的情况
   * 
   * @param props - 删除参数（联合类型，支持多种删除模式）
   * @param props.teamId - 团队ID（必需，用于权限验证）
   * @param props.id - 单个记录ID（可选）
   * @param props.datasetIds - 数据集ID列表（可选）
   * @param props.collectionIds - 集合ID列表（可选，需配合datasetIds使用）
   * @param props.idList - 记录ID列表（可选）
   * 
   * @returns Promise<any> - 删除操作完成
   * 
   * @example
   * ```typescript
   * // 删除单个记录
   * await pgVector.delete({ teamId: 'team_123', id: '456' });
   * 
   * // 删除整个数据集
   * await pgVector.delete({ 
   *   teamId: 'team_123', 
   *   datasetIds: ['dataset_456'] 
   * });
   * 
   * // 删除数据集中的特定集合
   * await pgVector.delete({ 
   *   teamId: 'team_123', 
   *   datasetIds: ['dataset_456'],
   *   collectionIds: ['collection_789'] 
   * });
   * 
   * // 批量删除指定记录
   * await pgVector.delete({ 
   *   teamId: 'team_123', 
   *   idList: ['1', '2', '3'] 
   * });
   * ```
   */
  delete = async (props: DelDatasetVectorCtrlProps): Promise<any> => {
    const { teamId } = props;

    // 1. 构建团队ID过滤条件（安全机制）
    const teamIdWhere = `team_id='${String(teamId)}' AND`;

    // 2. 根据不同的删除模式构建WHERE条件
    const where = await (() => {
      // 模式1：按单个ID删除
      if ('id' in props && props.id) {
        return `${teamIdWhere} id=${props.id}`;
      }

      // 模式2：按数据集ID删除（可选择特定集合）
      if ('datasetIds' in props && props.datasetIds) {
        const datasetIdWhere = `dataset_id IN (${props.datasetIds
          .map((id) => `'${String(id)}'`)
          .join(',')})`;

        // 如果同时指定了集合ID，添加集合过滤条件
        if ('collectionIds' in props && props.collectionIds) {
          return `${teamIdWhere} ${datasetIdWhere} AND collection_id IN (${props.collectionIds
            .map((id) => `'${String(id)}'`)
            .join(',')})`;
        }

        return `${teamIdWhere} ${datasetIdWhere}`;
      }

      // 模式3：按ID列表批量删除
      if ('idList' in props && Array.isArray(props.idList)) {
        if (props.idList.length === 0) return; // 空列表直接返回
        return `${teamIdWhere} id IN (${props.idList.map((id) => String(id)).join(',')})`;
      }
      
      // 无有效删除条件
      return Promise.reject('deleteDatasetData: no where');
    })();

    // 3. 如果没有有效的WHERE条件，直接返回
    if (!where) return;

    // 4. 执行删除操作
    await PgClient.delete(DatasetVectorTableName, {
      where: [where]
    });
  };
  /**
   * 向量相似度检索（Embedding Recall）
   * 
   * 这是向量数据库的核心检索功能，基于HNSW索引实现高效的向量相似度搜索。
   * 支持复杂的过滤条件和优化的查询策略。
   * 
   * 技术特点：
   * 1. 使用PgVector的内积操作符（<#>）进行相似度计算
   * 2. HNSW索引提供近似最近邻搜索，平衡精度和性能
   * 3. 支持集合级别的包含/排除过滤
   * 4. 事务级别的参数优化
   * 5. 分数转换（内积转余弦相似度）
   * 
   * 查询优化：
   * - ef_search: 搜索时的候选集大小，影响召回率和性能
   * - max_scan_tuples: 最大扫描元组数，防止查询超时
   * - iterative_scan: 使用relaxed_order模式优化性能
   * 
   * @param props - 检索参数
   * @param props.teamId - 团队ID，用于数据隔离
   * @param props.datasetIds - 数据集ID列表，限制检索范围
   * @param props.vector - 查询向量（1536维）
   * @param props.limit - 返回结果数量限制
   * @param props.forbidCollectionIdList - 禁止检索的集合ID列表
   * @param props.filterCollectionIdList - 仅检索的集合ID列表（白名单）
   * 
   * @returns Promise<EmbeddingRecallResponse> - 检索结果，包含ID、集合ID和相似度分数
   * 
   * @example
   * ```typescript
   * const results = await pgVector.embRecall({
   *   teamId: 'team_123',
   *   datasetIds: ['dataset_456'],
   *   vector: [0.1, 0.2, 0.3, ...], // 1536维查询向量
   *   limit: 10,
   *   forbidCollectionIdList: ['collection_exclude'],
   *   filterCollectionIdList: ['collection_include']
   * });
   * 
   * results.results.forEach(item => {
   *   console.log(`ID: ${item.id}, 相似度: ${item.score}`);
   * });
   * ```
   */
  embRecall = async (props: EmbeddingRecallCtrlProps): Promise<EmbeddingRecallResponse> => {
    const { teamId, datasetIds, vector, limit, forbidCollectionIdList, filterCollectionIdList } =
      props;

    // 1. 处理禁止检索的集合列表
    // 如果同时指定了白名单和黑名单，从黑名单中移除白名单中的项目
    const formatForbidCollectionIdList = (() => {
      if (!filterCollectionIdList) return forbidCollectionIdList;
      const list = forbidCollectionIdList
        .map((id) => String(id))
        .filter((id) => !filterCollectionIdList.includes(id));
      return list;
    })();
    
    // 构建禁止集合的SQL条件
    const forbidCollectionSql =
      formatForbidCollectionIdList.length > 0
        ? `AND collection_id NOT IN (${formatForbidCollectionIdList.map((id) => `'${id}'`).join(',')})`
        : '';

    // 2. 处理集合过滤列表（白名单）
    const formatFilterCollectionId = (() => {
      if (!filterCollectionIdList) return;

      // 从白名单中移除黑名单中的项目，避免冲突
      return filterCollectionIdList
        .map((id) => String(id))
        .filter((id) => !forbidCollectionIdList.includes(id));
    })();
    
    // 构建集合过滤的SQL条件
    const filterCollectionIdSql = formatFilterCollectionId
      ? `AND collection_id IN (${formatFilterCollectionId.map((id) => `'${id}'`).join(',')})`
      : '';
    
    // 3. 早期返回：如果白名单为空（所有项目都被黑名单排除），直接返回空结果
    if (formatFilterCollectionId && formatFilterCollectionId.length === 0) {
      return { results: [] };
    }

    // 4. 执行向量相似度检索查询
    const results: any = await PgClient.query(
      `BEGIN;
          -- 设置HNSW搜索参数（事务级别）
          SET LOCAL hnsw.ef_search = ${global.systemEnv?.hnswEfSearch || 100};           -- 搜索候选集大小
          SET LOCAL hnsw.max_scan_tuples = ${global.systemEnv?.hnswMaxScanTuples || 100000}; -- 最大扫描元组数
          SET LOCAL hnsw.iterative_scan = relaxed_order;                                  -- 使用relaxed模式优化性能
          
          -- 使用CTE进行优化的向量检索
          WITH relaxed_results AS MATERIALIZED (
            select id, collection_id, vector <#> '[${vector}]' AS score  -- 使用内积操作符计算相似度
              from ${DatasetVectorTableName}
              where dataset_id IN (${datasetIds.map((id) => `'${String(id)}'`).join(',')})  -- 数据集过滤
                ${filterCollectionIdSql}   -- 集合白名单过滤
                ${forbidCollectionSql}     -- 集合黑名单过滤
              order by score limit ${limit}  -- 按相似度排序并限制结果数量
          ) SELECT id, collection_id, score FROM relaxed_results ORDER BY score;
        COMMIT;`
    );
    // 5. 提取查询结果
    // PostgreSQL事务返回多个结果集，我们需要倒数第二个结果集
    const rows = results?.[results.length - 2]?.rows as PgSearchRawType[];

    // 6. 验证结果格式
    if (!Array.isArray(rows)) {
      return {
        results: []
      };
    }

    // 7. 转换结果格式并返回
    return {
      results: rows.map((item) => ({
        id: String(item.id),                    // 记录ID
        collectionId: item.collection_id,       // 集合ID
        score: item.score * -1                  // 分数转换：内积转余弦相似度（取负值）
      }))
    };
  };
  /**
   * 按时间范围获取向量数据
   * 
   * 根据创建时间范围查询向量数据的基本信息，主要用于：
   * 1. 数据统计和分析
   * 2. 数据清理和维护
   * 3. 监控和审计
   * 
   * @param start - 开始时间
   * @param end - 结束时间
   * 
   * @returns Promise<Array<{id: string, teamId: string, datasetId: string}>> - 时间范围内的向量数据信息
   * 
   * @example
   * ```typescript
   * const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
   * const now = new Date();
   * 
   * const recentData = await pgVector.getVectorDataByTime(yesterday, now);
   * console.log(`最近24小时新增 ${recentData.length} 条向量数据`);
   * ```
   */
  getVectorDataByTime = async (start: Date, end: Date) => {
    // 执行时间范围查询
    const { rows } = await PgClient.query<{
      id: string;
      team_id: string;
      dataset_id: string;
    }>(`SELECT id, team_id, dataset_id
    FROM ${DatasetVectorTableName}
    WHERE createtime BETWEEN '${dayjs(start).format('YYYY-MM-DD HH:mm:ss')}' AND '${dayjs(
      end
    ).format('YYYY-MM-DD HH:mm:ss')}';
    `);

    // 转换结果格式
    return rows.map((item) => ({
      id: String(item.id),
      teamId: item.team_id,
      datasetId: item.dataset_id
    }));
  };
  /**
   * 获取团队的向量数据总数
   * 
   * 统计指定团队的所有向量数据数量，用于：
   * 1. 资源使用量统计
   * 2. 配额管理
   * 3. 计费统计
   * 
   * @param teamId - 团队ID
   * @returns Promise<number> - 向量数据总数
   * 
   * @example
   * ```typescript
   * const count = await pgVector.getVectorCountByTeamId('team_123');
   * console.log(`团队共有 ${count} 条向量数据`);
   * ```
   */
  getVectorCountByTeamId = async (teamId: string) => {
    const total = await PgClient.count(DatasetVectorTableName, {
      where: [['team_id', String(teamId)]]
    });

    return total;
  };
  
  /**
   * 获取数据集的向量数据总数
   * 
   * 统计指定数据集的向量数据数量，用于：
   * 1. 数据集规模监控
   * 2. 性能优化参考
   * 3. 数据集管理
   * 
   * @param teamId - 团队ID（权限验证）
   * @param datasetId - 数据集ID
   * @returns Promise<number> - 数据集的向量数据总数
   * 
   * @example
   * ```typescript
   * const count = await pgVector.getVectorCountByDatasetId('team_123', 'dataset_456');
   * console.log(`数据集包含 ${count} 条向量数据`);
   * ```
   */
  getVectorCountByDatasetId = async (teamId: string, datasetId: string) => {
    const total = await PgClient.count(DatasetVectorTableName, {
      where: [['team_id', String(teamId)], 'and', ['dataset_id', String(datasetId)]]
    });

    return total;
  };
  
  /**
   * 获取集合的向量数据总数
   * 
   * 统计指定集合的向量数据数量，用于：
   * 1. 集合级别的数据统计
   * 2. 细粒度的数据管理
   * 3. 集合性能分析
   * 
   * @param teamId - 团队ID（权限验证）
   * @param datasetId - 数据集ID
   * @param collectionId - 集合ID
   * @returns Promise<number> - 集合的向量数据总数
   * 
   * @example
   * ```typescript
   * const count = await pgVector.getVectorCountByCollectionId(
   *   'team_123', 
   *   'dataset_456', 
   *   'collection_789'
   * );
   * console.log(`集合包含 ${count} 条向量数据`);
   * ```
   */
  getVectorCountByCollectionId = async (
    teamId: string,
    datasetId: string,
    collectionId: string
  ) => {
    const total = await PgClient.count(DatasetVectorTableName, {
      where: [
        ['team_id', String(teamId)],
        'and',
        ['dataset_id', String(datasetId)],
        'and',
        ['collection_id', String(collectionId)]
      ]
    });

    return total;
  };
}

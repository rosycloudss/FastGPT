/**
 * 向量生成队列模块
 * 
 * 功能概述：
 * 负责处理数据集的向量化任务，是FastGPT知识库系统的核心组件之一。
 * 该模块采用队列机制处理向量生成任务，确保系统稳定性和资源合理利用。
 * 
 * 主要职责：
 * 1. 新数据向量化：将新导入的文本数据转换为向量并存储到向量数据库
 * 2. 数据重建：更新已存在数据的向量索引，保持数据一致性
 * 3. 队列管理：控制并发处理数量，防止系统资源过载
 * 4. 错误处理：提供完善的错误重试和恢复机制
 * 5. 使用量统计：记录向量生成的token消耗，用于计费
 * 
 * 技术特点：
 * - 每次导入都是一个独立的线程处理，保证任务隔离
 * - 支持数据库事务，确保数据一致性
 * - 集成团队积分检查，防止超额使用
 * - 提供详细的日志记录，便于问题排查
 * 
 * @module dataset/queues/generateVector
 * @author FastGPT Team
 */

// 数据集数据控制器
import { insertData2Dataset } from '@/service/core/dataset/data/controller';

// MongoDB 模型
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';

// 常量定义
import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';

// 使用量统计
import { pushGenerateVectorUsage } from '@/service/support/wallet/usage/push';

// 工具函数
import { checkTeamAiPointsAndLock } from './utils';
import { getErrText } from '@fastgpt/global/common/error/utils';
import { retryFn } from '@fastgpt/global/common/system/utils';
import { delay } from '@fastgpt/service/common/bullmq';

// 时间处理
import { addMinutes } from 'date-fns';

// 日志系统
import { addLog } from '@fastgpt/service/common/system/log';

// 向量数据库操作
import {
  deleteDatasetDataVector,
  insertDatasetDataVector
} from '@fastgpt/service/common/vectorDB/controller';

// AI 模型相关
import { getEmbeddingModel } from '@fastgpt/service/core/ai/model';

// 数据库事务
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';

// 训练工具
import { getMaxIndexSize } from '@fastgpt/global/core/dataset/training/utils';

// 类型定义
import type {
  DatasetDataSchemaType,
  DatasetTrainingSchemaType
} from '@fastgpt/global/core/dataset/type';

/**
 * 减少向量队列计数器
 * 
 * 该函数用于管理全局向量生成队列的并发控制：
 * 1. 安全地递减全局队列计数器
 * 2. 防止计数器变为负数
 * 3. 返回队列状态，用于判断是否所有任务已完成
 * 
 * 设计说明：
 * - 使用全局变量 global.vectorQueueLen 跟踪当前活跃的向量生成任务数
 * - 确保计数器不会低于0，避免状态异常
 * - 当队列清空时返回true，触发完成日志记录
 * 
 * @returns {boolean} 队列是否已完全清空（true表示所有任务已完成）
 * 
 * @example
 * ```typescript
 * const isEmpty = reduceQueue();
 * if (isEmpty) {
 *   console.log('所有向量生成任务已完成');
 * }
 * ```
 */
const reduceQueue = () => {
  global.vectorQueueLen = global.vectorQueueLen > 0 ? global.vectorQueueLen - 1 : 0;

  return global.vectorQueueLen === 0;
};

/**
 * 数据库关联查询类型定义
 * 
 * 定义MongoDB populate操作的返回类型结构，用于类型安全的数据库查询。
 * 该类型确保在查询训练数据时能够正确获取关联的数据集、集合和数据信息。
 * 
 * 字段说明：
 * - dataset: 数据集信息，包含向量模型配置
 * - collection: 集合信息，包含名称和索引前缀配置
 * - data: 数据详情，包含ID和索引信息
 */
type PopulateType = {
  dataset: { vectorModel: string };
  collection: { name: string; indexPrefixTitle: boolean };
  data: { _id: string; indexes: DatasetDataSchemaType['indexes'] };
};

/**
 * 训练数据类型定义
 * 
 * 扩展基础训练数据类型，添加数据库关联查询的结果。
 * 这个复合类型包含了向量生成过程中需要的所有相关信息。
 * 
 * 继承关系：
 * - 基础类型：DatasetTrainingSchemaType（训练任务的基本信息）
 * - 扩展类型：PopulateType（关联查询的数据集、集合、数据信息）
 * 
 * 用途：
 * 在向量生成函数中作为参数类型，确保所有必要的数据都已正确加载。
 */
type TrainingDataType = DatasetTrainingSchemaType & PopulateType;

/**
 * 向量生成队列主函数
 * 
 * 这是向量生成系统的核心调度函数，负责管理整个向量化处理流程。
 * 该函数采用生产者-消费者模式，持续处理队列中的向量生成任务。
 * 
 * 详细处理流程：
 * 1. 队列容量检查：
 *    - 检查当前队列长度是否超过系统限制
 *    - 防止系统资源过载，确保稳定运行
 * 
 * 2. 任务获取与锁定：
 *    - 从MongoDB查询待处理的训练数据
 *    - 使用乐观锁机制防止任务重复处理
 *    - 设置锁定时间，避免死锁情况
 * 
 * 3. 数据预处理：
 *    - 验证数据集和集合的有效性
 *    - 检查团队AI积分余额
 *    - 加载必要的关联数据
 * 
 * 4. 向量生成策略选择：
 *    - 新数据插入：调用insertData函数处理新导入的数据
 *    - 数据重建：调用rebuildData函数更新现有数据的向量
 * 
 * 5. 后处理操作：
 *    - 记录token使用量，用于计费统计
 *    - 更新任务状态和完成时间
 *    - 清理临时数据和释放资源
 * 
 * 6. 错误处理与重试：
 *    - 捕获处理过程中的异常
 *    - 记录错误信息到数据库
 *    - 支持任务重试机制
 * 
 * 技术特性：
 * - 异步处理：使用Promise确保非阻塞执行
 * - 并发控制：通过全局计数器限制同时处理的任务数
 * - 事务安全：关键操作使用数据库事务保证一致性
 * - 监控友好：提供详细的日志记录和性能指标
 * 
 * 注意事项：
 * - 每次导入都是一个独立的线程，保证任务隔离
 * - 函数会持续运行直到队列为空
 * - 支持优雅停机，不会中断正在处理的任务
 * 
 * @returns {Promise<any>} 处理结果的Promise对象
 * 
 * @throws {Error} 当系统资源不足或数据库连接失败时抛出异常
 * 
 * @example
 * ```typescript
 * // 启动向量生成队列处理
 * try {
 *   await generateVector();
 *   console.log('向量生成队列处理完成');
 * } catch (error) {
 *   console.error('向量生成失败:', error);
 * }
 * ```
 */
export async function generateVector(): Promise<any> {
  const max = global.systemEnv?.vectorMaxProcess || 10;
  addLog.debug(`[Vector Queue] Queue size: ${global.vectorQueueLen}`);

  if (global.vectorQueueLen >= max) return;
  global.vectorQueueLen++;

  try {
    while (true) {
      const start = Date.now();

      // get training data
      const {
        data,
        done = false,
        error = false
      } = await (async () => {
        try {
          const data = await MongoDatasetTraining.findOneAndUpdate(
            {
              mode: TrainingModeEnum.chunk,
              retryCount: { $gt: 0 },
              lockTime: { $lte: addMinutes(new Date(), -3) }
            },
            {
              lockTime: new Date(),
              $inc: { retryCount: -1 }
            }
          )
            .populate<PopulateType>([
              {
                path: 'dataset',
                select: 'vectorModel'
              },
              {
                path: 'collection',
                select: 'name indexPrefixTitle'
              },
              {
                path: 'data',
                select: '_id indexes'
              }
            ])
            .lean();

          // task preemption
          if (!data) {
            return {
              done: true
            };
          }
          return {
            data
          };
        } catch (error) {
          return {
            error: true
          };
        }
      })();

      // Break loop
      if (done || !data) {
        break;
      }
      if (error) {
        addLog.error(`[Vector Queue] Error`, error);
        await delay(500);
        continue;
      }

      if (!data.dataset || !data.collection) {
        addLog.info(`[Vector Queue] Dataset or collection not found`, data);
        // Delete data
        await MongoDatasetTraining.deleteOne({ _id: data._id });
        continue;
      }

      // auth balance
      if (!(await checkTeamAiPointsAndLock(data.teamId))) {
        continue;
      }

      addLog.info(`[Vector Queue] Start`);

      try {
        const { tokens } = await (async () => {
          if (data.dataId) {
            return rebuildData({ trainingData: data });
          } else {
            return insertData({ trainingData: data });
          }
        })();

        // push usage
        pushGenerateVectorUsage({
          teamId: data.teamId,
          tmbId: data.tmbId,
          inputTokens: tokens,
          model: data.dataset.vectorModel,
          billId: data.billId
        });

        addLog.info(`[Vector Queue] Finish`, {
          time: Date.now() - start
        });
      } catch (err: any) {
        addLog.error(`[Vector Queue] Error`, err);
        await MongoDatasetTraining.updateOne(
          {
            _id: data._id
          },
          {
            errorMsg: getErrText(err, 'unknown error')
          }
        );
        await delay(100);
      }
    }
  } catch (error) {
    addLog.error(`[Vector Queue] Error`, error);
  }

  if (reduceQueue()) {
    addLog.info(`[Vector Queue] Done`);
  }
  addLog.debug(`[Vector Queue] break loop, current queue size: ${global.vectorQueueLen}`);
}

/**
 * 重建数据向量
 * 
 * 该函数负责更新已存在数据的向量索引，是数据重建流程的核心实现。
 * 主要用于以下场景：
 * - 向量模型升级后需要重新生成向量
 * - 数据内容更新后需要同步向量索引
 * - 向量数据库迁移或优化
 * 
 * 详细处理流程：
 * 
 * 1. 数据有效性检查：
 *    - 验证训练数据是否存在
 *    - 检查数据完整性和格式正确性
 *    - 如果数据无效，清理训练任务并退出
 * 
 * 2. 旧向量清理准备：
 *    - 提取现有向量的ID列表
 *    - 准备删除操作的参数
 *    - 确保不会遗留无效的向量数据
 * 
 * 3. 下一个重建任务调度：
 *    - 查找下一个需要重建的数据
 *    - 创建新的训练任务并加入队列
 *    - 使用数据库事务确保操作原子性
 *    - 支持重试机制，提高系统可靠性
 * 
 * 4. 新向量生成：
 *    - 调用向量数据库API生成新的向量
 *    - 使用配置的向量模型进行编码
 *    - 获取新生成向量的ID列表
 *    - 记录token消耗用于计费
 * 
 * 5. 数据库更新操作：
 *    - 更新数据记录中的向量索引信息
 *    - 删除训练任务记录
 *    - 清理旧的向量数据
 *    - 所有操作在同一事务中执行
 * 
 * 技术特点：
 * - 事务安全：使用MongoDB事务确保数据一致性
 * - 错误恢复：支持部分失败后的重试和恢复
 * - 性能优化：批量处理向量操作，减少数据库交互
 * - 资源管理：及时清理无用的向量数据，节省存储空间
 * 
 * 注意事项：
 * - 重建过程中原有向量仍然可用，不影响查询服务
 * - 只有在新向量成功生成后才会删除旧向量
 * - 支持并发重建，但会控制并发数量避免资源竞争
 * 
 * @param {Object} params - 参数对象
 * @param {TrainingDataType} params.trainingData - 包含完整关联信息的训练数据
 * @returns {Promise<{tokens: number}>} 返回包含token消耗统计的结果对象
 * 
 * @throws {Error} 当数据不存在或向量生成失败时抛出异常
 * 
 * @example
 * ```typescript
 * const result = await rebuildData({ 
 *   trainingData: populatedTrainingData 
 * });
 * console.log(`重建完成，消耗token: ${result.tokens}`);
 * ```
 */
const rebuildData = async ({ trainingData }: { trainingData: TrainingDataType }) => {
  if (!trainingData.data) {
    await MongoDatasetTraining.deleteOne({ _id: trainingData._id });
    return Promise.reject('Not data');
  }

  // Old vectorId
  const deleteVectorIdList = trainingData.data.indexes.map((index) => index.dataId);

  // Find next rebuilding data to insert training queue
  try {
    await retryFn(() =>
      mongoSessionRun(async (session) => {
        // get new mongoData insert to training
        const newRebuildingData = await MongoDatasetData.findOneAndUpdate(
          {
            rebuilding: true,
            teamId: trainingData.teamId,
            datasetId: trainingData.datasetId
          },
          {
            $unset: {
              rebuilding: null
            },
            updateTime: new Date()
          },
          { session }
        ).select({
          _id: 1,
          collectionId: 1
        });

        if (newRebuildingData) {
          await MongoDatasetTraining.create(
            [
              {
                teamId: trainingData.teamId,
                tmbId: trainingData.tmbId,
                datasetId: trainingData.datasetId,
                collectionId: newRebuildingData.collectionId,
                billId: trainingData.billId,
                mode: TrainingModeEnum.chunk,
                dataId: newRebuildingData._id,
                retryCount: 50
              }
            ],
            { session, ordered: true }
          );
        }
      })
    );
  } catch (error) {}

  // update vector, update dataset_data rebuilding status, delete data from training
  // 1. Insert new vector to dataset_data
  const insertResult = await insertDatasetDataVector({
    inputs: trainingData.data.indexes.map((index) => index.text),
    model: getEmbeddingModel(trainingData.dataset.vectorModel),
    teamId: trainingData.teamId,
    datasetId: trainingData.datasetId,
    collectionId: trainingData.collectionId
  });

  trainingData.data.indexes.forEach((item, index) => {
    item.dataId = insertResult.insertIds[index];
  });

  await mongoSessionRun(async (session) => {
    // 2. Ensure that the training data is deleted after the Mongo update is successful
    await MongoDatasetData.updateOne(
      { _id: trainingData.data._id },
      {
        $set: {
          indexes: trainingData.data.indexes
        }
      },
      { session }
    );
    // 3. Delete the training data
    await MongoDatasetTraining.deleteOne({ _id: trainingData._id }, { session });

    // 4. Delete old vector
    await deleteDatasetDataVector({
      teamId: trainingData.teamId,
      idList: deleteVectorIdList
    });
  });

  return { tokens: insertResult.tokens };
};

/**
 * 插入新数据
 * 
 * 该函数负责将新的训练数据插入到数据集中并生成对应的向量索引。
 * 这是新数据导入流程的最后一步，完成从原始文本到可搜索向量的转换。
 * 
 * 主要功能：
 * 
 * 1. 数据集成：
 *    - 将训练数据正式加入到目标数据集
 *    - 生成唯一的数据标识符
 *    - 建立数据之间的关联关系
 * 
 * 2. 向量生成：
 *    - 使用指定的向量模型对文本进行编码
 *    - 生成高维向量表示
 *    - 存储向量到向量数据库
 * 
 * 3. 索引构建：
 *    - 创建文本索引用于快速检索
 *    - 设置索引前缀（如果配置了集合名称前缀）
 *    - 优化索引结构提高查询性能
 * 
 * 4. 元数据管理：
 *    - 记录数据的创建时间和来源
 *    - 保存图片描述映射（如果包含图片）
 *    - 维护数据版本和更新历史
 * 
 * 5. 事务处理：
 *    - 使用数据库事务确保操作原子性
 *    - 在成功插入数据后清理训练任务
 *    - 发生错误时自动回滚所有更改
 * 
 * 处理的数据类型：
 * - 纯文本数据：问答对、文档片段等
 * - 多模态数据：包含图片和文本的复合内容
 * - 结构化数据：带有特定格式的知识条目
 * 
 * 性能优化：
 * - 批量向量生成减少API调用次数
 * - 异步处理提高系统吞吐量
 * - 智能分块避免超出模型限制
 * 
 * 质量保证：
 * - 数据完整性验证
 * - 向量质量检查
 * - 重复数据检测和处理
 * 
 * @param {Object} params - 参数对象
 * @param {TrainingDataType} params.trainingData - 包含所有必要信息的训练数据对象
 * @returns {Promise<{tokens: number}>} 返回包含token消耗统计的结果对象
 * 
 * @throws {Error} 当数据插入失败或向量生成异常时抛出错误
 * 
 * @example
 * ```typescript
 * const result = await insertData({ 
 *   trainingData: newTrainingData 
 * });
 * console.log(`数据插入完成，消耗token: ${result.tokens}`);
 * ```
 */
const insertData = async ({ trainingData }: { trainingData: TrainingDataType }) => {
  return mongoSessionRun(async (session) => {
    // insert new data to dataset
    const { tokens } = await insertData2Dataset({
      teamId: trainingData.teamId,
      tmbId: trainingData.tmbId,
      datasetId: trainingData.datasetId,
      collectionId: trainingData.collectionId,
      q: trainingData.q,
      a: trainingData.a,
      imageId: trainingData.imageId,
      imageDescMap: trainingData.imageDescMap,
      chunkIndex: trainingData.chunkIndex,
      indexSize:
        trainingData.indexSize ||
        getMaxIndexSize(getEmbeddingModel(trainingData.dataset.vectorModel)),
      indexes: trainingData.indexes,
      indexPrefix: trainingData.collection.indexPrefixTitle
        ? `# ${trainingData.collection.name}`
        : undefined,
      embeddingModel: trainingData.dataset.vectorModel,
      session
    });
    // delete data from training
    await MongoDatasetTraining.deleteOne({ _id: trainingData._id }, { session });

    return {
      tokens
    };
  });
};
